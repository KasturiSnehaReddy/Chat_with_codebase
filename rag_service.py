#!/usr/bin/env python3
import json
import os
import threading
from typing import Dict, Any

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer, CrossEncoder

from multi_file_chunker import extract_chunks_from_folder
from rag_code_search import (
    EMBEDDING_MODEL_NAME,
    ask_llm,
    build_index_from_model,
    compute_codebase_fingerprint,
    load_cache,
    rerank_chunks,
    save_cache,
    search,
)

app = FastAPI(title="RAG Service", version="1.0.0")

REGISTRY_PATH = os.path.join(os.path.dirname(__file__), ".rag_service_registry.json")

_store_lock = threading.Lock()
_embedding_model: SentenceTransformer | None = None
_reranker: CrossEncoder | None = None
_chat_store: Dict[str, Dict[str, Any]] = {}
_chat_registry: Dict[str, Dict[str, Any]] = {}
DEFAULT_TOP_K = 4
MAX_TOP_K = 4


class UploadRequest(BaseModel):
    chat_id: str
    folder_path: str


class AskRequest(BaseModel):
    chat_id: str
    query: str
    top_k: int = DEFAULT_TOP_K


def _load_registry() -> Dict[str, Dict[str, Any]]:
    if not os.path.isfile(REGISTRY_PATH):
        return {}
    try:
        with open(REGISTRY_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _save_registry(registry: Dict[str, Dict[str, Any]]) -> None:
    with open(REGISTRY_PATH, "w", encoding="utf-8") as f:
        json.dump(registry, f, ensure_ascii=True)


def _ensure_models_loaded() -> None:
    global _embedding_model, _reranker
    if _embedding_model is None:
        _embedding_model = SentenceTransformer(EMBEDDING_MODEL_NAME)
    if _reranker is None:
        _reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")


def _load_chat_state(chat_id: str) -> Dict[str, Any]:
    state = _chat_store.get(chat_id)
    if state is not None:
        return state

    reg = _chat_registry.get(chat_id)
    if not reg:
        raise HTTPException(status_code=404, detail="chat_id not indexed. Upload first.")

    folder_path = reg.get("folder_path")
    fingerprint = reg.get("fingerprint")
    if not folder_path or not os.path.isdir(folder_path):
        raise HTTPException(status_code=404, detail="project folder missing on server")

    chunks, index = load_cache(folder_path, EMBEDDING_MODEL_NAME, fingerprint)
    if chunks is None or index is None:
        raise HTTPException(status_code=409, detail="index not found for chat_id. Re-upload project.")

    state = {
        "folder_path": folder_path,
        "fingerprint": fingerprint,
        "chunks": chunks,
        "index": index,
        "chunk_count": len(chunks),
    }
    _chat_store[chat_id] = state
    return state


@app.on_event("startup")
def startup_event() -> None:
    # Load heavy models in a background thread so the server binds the port fast
    try:
        threading.Thread(target=_ensure_models_loaded, daemon=True).start()
    except Exception:
        # fallback to synchronous load if threading fails
        _ensure_models_loaded()

    global _chat_registry
    _chat_registry = _load_registry()


@app.get("/health")
def health() -> Dict[str, Any]:
    status = "loading" if (_embedding_model is None or _reranker is None) else "ok"
    return {
        "status": status,
        "embedding_model": EMBEDDING_MODEL_NAME,
        "reranker": "cross-encoder/ms-marco-MiniLM-L-6-v2",
        "indexed_chats_in_memory": len(_chat_store),
    }


@app.post("/upload")
def upload(req: UploadRequest) -> Dict[str, Any]:
    _ensure_models_loaded()
    if not os.path.isdir(req.folder_path):
        raise HTTPException(status_code=400, detail="folder_path not found")

    chat_id = str(req.chat_id)
    folder_path = req.folder_path

    # One-time heavy processing: chunk + embed + index (or load if valid cache already exists).
    fingerprint = compute_codebase_fingerprint(folder_path)
    chunks, index = load_cache(folder_path, EMBEDDING_MODEL_NAME, fingerprint)
    cache_hit = chunks is not None and index is not None

    if not cache_hit:
        chunks = extract_chunks_from_folder(folder_path)
        if not chunks:
            raise HTTPException(status_code=400, detail="No supported chunks found in project")

        index = build_index_from_model(chunks, _embedding_model)
        save_cache(folder_path, chunks, index, EMBEDDING_MODEL_NAME, fingerprint)

    with _store_lock:
        _chat_store[chat_id] = {
            "folder_path": folder_path,
            "fingerprint": fingerprint,
            "chunks": chunks,
            "index": index,
            "chunk_count": len(chunks),
        }
        _chat_registry[chat_id] = {
            "folder_path": folder_path,
            "fingerprint": fingerprint,
            "chunk_count": len(chunks),
        }
        _save_registry(_chat_registry)

    return {
        "ok": True,
        "chat_id": chat_id,
        "cache_hit": bool(cache_hit),
        "chunk_count": len(chunks),
    }


@app.post("/ask")
def ask(req: AskRequest) -> Dict[str, Any]:
    _ensure_models_loaded()
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="query is required")

    state = _load_chat_state(str(req.chat_id))

    # Query-time lightweight flow: query embedding + retrieval + rerank + LLM.
    retrieved = search(req.query, _embedding_model, state["index"], state["chunks"], k=15)
    top_k = min(MAX_TOP_K, max(1, int(req.top_k)))
    reranked = rerank_chunks(req.query, retrieved, _reranker, top_k=top_k)
    answer = ask_llm(req.query, reranked)

    sources = []
    for chunk in reranked:
        sources.append(
            {
                "file": chunk.get("file"),
                "type": chunk.get("type", "text"),
                "distance": chunk.get("distance"),
                "rerank_score": chunk.get("rerank_score"),
                "snippet": (chunk.get("content") or "")[:400],
            }
        )

    return {
        "chat_id": str(req.chat_id),
        "answer": answer,
        "sources": sources,
        "chunk_count": state.get("chunk_count", 0),
    }
