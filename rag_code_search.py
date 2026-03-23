import os
import json
import hashlib
import numpy as np
import faiss
import requests
from sentence_transformers import SentenceTransformer, CrossEncoder
from multi_file_chunker import extract_chunks_from_folder


FINAL_CONTEXT_CHUNKS = 5
MAX_COVERAGE_ADDITIONS = 6
COVERAGE_TYPES = ("function", "class", "global", "text", "summary")
EMBEDDING_MODEL_NAME = "intfloat/e5-large-v2"


def get_cache_paths(folder_path):
    cache_dir = os.path.join(folder_path, ".rag_cache")
    return {
        "dir": cache_dir,
        "index": os.path.join(cache_dir, "faiss.index"),
        "chunks": os.path.join(cache_dir, "chunks.json"),
        "meta": os.path.join(cache_dir, "meta.json"),
    }


def compute_codebase_fingerprint(folder_path):
    """Build a stable hash from relevant files and their mtime/size."""
    supported_exts = {
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".java",
        ".md",
        ".yaml",
        ".yml",
        ".properties",
        ".sql",
        ".json",
    }
    entries = []

    for current_dir, _, files in os.walk(folder_path):
        if ".rag_cache" in current_dir.split(os.sep):
            continue

        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in supported_exts:
                continue

            file_path = os.path.join(current_dir, filename)
            try:
                stat = os.stat(file_path)
            except OSError:
                continue

            rel = os.path.relpath(file_path, folder_path).replace("\\", "/")
            entries.append(f"{rel}|{int(stat.st_mtime)}|{stat.st_size}")

    entries.sort()
    digest = hashlib.sha256("\n".join(entries).encode("utf-8")).hexdigest()
    return digest


def save_cache(folder_path, chunks, index, model_name, fingerprint):
    paths = get_cache_paths(folder_path)
    os.makedirs(paths["dir"], exist_ok=True)

    with open(paths["chunks"], "w", encoding="utf-8") as f:
        json.dump(chunks, f, ensure_ascii=True)

    faiss.write_index(index, paths["index"])

    meta = {
        "model_name": model_name,
        "fingerprint": fingerprint,
        "chunk_count": len(chunks),
    }
    with open(paths["meta"], "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=True)


def load_cache(folder_path, model_name, fingerprint):
    paths = get_cache_paths(folder_path)
    if not (
        os.path.isfile(paths["meta"])
        and os.path.isfile(paths["chunks"])
        and os.path.isfile(paths["index"])
    ):
        return None, None

    try:
        with open(paths["meta"], "r", encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        return None, None

    if meta.get("model_name") != model_name:
        return None, None
    if meta.get("fingerprint") != fingerprint:
        return None, None

    try:
        with open(paths["chunks"], "r", encoding="utf-8") as f:
            chunks = json.load(f)
        index = faiss.read_index(paths["index"])
    except Exception:
        return None, None

    if index.ntotal != len(chunks):
        return None, None

    return chunks, index


def build_index_from_model(chunks, model):
    """Build embeddings with passage prefix and add them to FAISS IndexFlatL2."""
    passages = [
        f"passage: {chunk.get('embedding_text', chunk['content'])}"
        for chunk in chunks
    ]
    embeddings = model.encode(passages, convert_to_numpy=True)
    embeddings = np.asarray(embeddings, dtype="float32")

    index = faiss.IndexFlatL2(embeddings.shape[1])
    index.add(embeddings)

    return index


def get_or_build_index(folder_path, model_name=EMBEDDING_MODEL_NAME):
    """Load cached chunks/index when possible; otherwise rebuild and save cache."""
    model = SentenceTransformer(model_name)
    fingerprint = compute_codebase_fingerprint(folder_path)

    cached_chunks, cached_index = load_cache(folder_path, model_name, fingerprint)
    if cached_chunks is not None and cached_index is not None:
        return model, cached_chunks, cached_index, True

    chunks = extract_chunks_from_folder(folder_path)
    if not chunks:
        return model, [], None, False

    index = build_index_from_model(chunks, model)
    save_cache(folder_path, chunks, index, model_name, fingerprint)
    return model, chunks, index, False


def build_index(chunks, model_name="intfloat/e5-large-v2"):
    """
    Build embeddings with passage prefix and add them to FAISS IndexFlatL2.
    """
    model = SentenceTransformer(model_name)
    index = build_index_from_model(chunks, model)

    return model, index


def search_chunks(query, model, index, chunks, k=15):
    """
    Search top-k relevant chunks for a query.
    """
    query_text = f"query: {query}"
    query_embedding = model.encode([query_text], convert_to_numpy=True)
    query_embedding = np.asarray(query_embedding, dtype="float32")

    k = min(k, len(chunks))
    distances, indices = index.search(query_embedding, k)

    results = []
    for idx, dist in zip(indices[0], distances[0]):
        if idx == -1:
            continue

        results.append({
            "file": chunks[idx]["file"],
            "content": chunks[idx]["content"],
            "type": chunks[idx].get("type", "text"),
            "distance": float(dist),
        })

    return results


def search(query, model, index, chunks, k=15):
    """
    Small wrapper to keep main flow simple.
    """
    return search_chunks(query, model, index, chunks, k=k)


def rerank_chunks(query, retrieved_chunks, reranker, top_k=3):
    """
    Re-rank with CrossEncoder and keep highest-scoring unique chunks.
    """
    if not retrieved_chunks:
        return []

    # Score all pairs with CrossEncoder.
    pairs = [(query, chunk["content"]) for chunk in retrieved_chunks]
    scores = reranker.predict(pairs)

    scored_chunks = []
    for chunk, score in zip(retrieved_chunks, scores):
        updated = dict(chunk)
        updated["rerank_score"] = float(score)
        scored_chunks.append(updated)

    scored_chunks.sort(key=lambda x: x["rerank_score"], reverse=True)

    selected = []
    selected_keys = set()

    def chunk_key(chunk):
        return (chunk.get("file"), chunk.get("type"), chunk.get("content"))

    # Keep top-k unique chunks by rerank score.
    for chunk in scored_chunks:
        if len(selected) >= top_k:
            break

        key = chunk_key(chunk)
        if key in selected_keys:
            continue

        selected.append(chunk)
        selected_keys.add(key)

    return selected


def add_type_balanced_coverage(
    query,
    model,
    retrieved_chunks,
    all_chunks,
    max_additions=6,
    candidate_types=COVERAGE_TYPES,
):
    """
    Expand retrieved candidates with query-aware chunks from multiple types.

    1) Keep original retrieved chunks.
    2) Filter candidate chunks by configured chunk types.
    3) Score candidates against query using embedding similarity.
    4) Add top missing chunks up to max_additions.
    5) Remove duplicates.
    """
    merged = list(retrieved_chunks)

    existing_keys = {
        (c.get("file"), c.get("type"), c.get("content"))
        for c in merged
    }

    candidate_chunks = [
        c
        for c in all_chunks
        if c.get("type") in set(candidate_types) and c.get("content")
    ]
    if not candidate_chunks or max_additions <= 0:
        return merged

    query_vec = model.encode(
        [f"query: {query}"],
        convert_to_numpy=True,
    ).astype("float32")
    query_vec = query_vec[0]
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return merged
    query_vec = query_vec / query_norm

    passages = [
        f"passage: {c.get('embedding_text', c['content'])}"
        for c in candidate_chunks
    ]
    candidate_vecs = model.encode(passages, convert_to_numpy=True).astype("float32")
    candidate_norms = np.linalg.norm(candidate_vecs, axis=1, keepdims=True)
    candidate_norms[candidate_norms == 0] = 1.0
    candidate_vecs = candidate_vecs / candidate_norms

    similarities = candidate_vecs @ query_vec
    ranked_indices = np.argsort(-similarities)

    added = 0
    for idx in ranked_indices:
        if added >= max_additions:
            break

        chunk = candidate_chunks[int(idx)]
        candidate = {
            "file": chunk.get("file"),
            "content": chunk.get("content"),
            "type": chunk.get("type", "text"),
        }
        key = (candidate["file"], candidate["type"], candidate["content"])
        if key in existing_keys:
            continue

        merged.append(candidate)
        existing_keys.add(key)
        added += 1

    return merged


def ask_llm(query, retrieved_chunks):
    """
    Send retrieved code chunks + user question to local Ollama (mistral).
    """
    if not retrieved_chunks:
        return "No relevant code chunks were found to answer this question."

    context_parts = []
    for item in retrieved_chunks:
        context_parts.append(f"File: {item['file']}\n{item['content']}")
    context = "\n\n".join(context_parts)

    prompt = f"""
You are a senior software engineer analyzing a codebase.

Use ONLY the provided code context below.
Do NOT use prior knowledge, memory, or assumptions outside this context.
Do NOT assume line numbers or positions.
If the context does not contain enough information, reply exactly:
Insufficient context to answer from the provided code.

Instructions:
- Explain clearly and mention file names.
- For general questions (for example project overview), combine multiple chunks to infer project purpose.
- Prioritize core logic such as functions, classes, and processing behavior.
- Do not rely only on UI/frontend code unless the question is specifically about UI.

Question:
{query}

Code:
{context}
"""

    payload = {
        "model": "mistral",
        "prompt": prompt,
        "stream": False,
    }

    try:
        response = requests.post(
            "http://localhost:11434/api/generate",
            json=payload,
            timeout=120,
        )
        response.raise_for_status()
        data = response.json()
        return data.get("response", "No response text returned by Ollama.").strip()
    except Exception as e:
        return f"LLM request failed: {e}"


def print_results(results):
    if not results:
        print("No results found.")
        return

    for i, item in enumerate(results, start=1):
        print(f"\nResult {i}:")
        print(f"File: {item['file']}")
        print("Code content:")
        print(item["content"])
        print("-" * 60)


def main():
    folder_path = input("Enter folder path to ingest: ").strip().strip('"\'')

    if not folder_path or not os.path.isdir(folder_path):
        print("Invalid folder path.")
        return

    print(f"\nIndexing directory: {folder_path}")
    print("Loading embeddings/index cache if available...")
    model, chunks, index, cache_hit = get_or_build_index(
        folder_path,
        model_name=EMBEDDING_MODEL_NAME,
    )

    if cache_hit:
        print("Cache hit: using saved FAISS index and chunks.")
    else:
        print("Cache miss: rebuilt chunks + embeddings and saved cache.")

    print(f"Total chunks: {len(chunks)}")

    print("First 5 chunk file paths:")
    for i, chunk in enumerate(chunks[:5], start=1):
        print(f"{i}. {chunk['file']}")

    if not chunks:
        print("No valid chunks found.")
        return

    reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
    print("Ready for search. Type 'exit' to quit.")

    while True:
        query = input("\nEnter query: ").strip()
        if not query:
            continue
        if query.lower() in {"exit", "quit"}:
            print("Goodbye.")
            break

        # Step 1: Initial retrieval - get top 15 candidates from FAISS
        print("\n[1/3] Retrieving top 15 candidates from FAISS...")
        initial_results = search(query, model, index, chunks, k=15)

        # Step 1.5: Add type-balanced coverage candidates from full chunk pool.
        expanded_results = add_type_balanced_coverage(
            query,
            model,
            initial_results,
            chunks,
            max_additions=MAX_COVERAGE_ADDITIONS,
            candidate_types=COVERAGE_TYPES,
        )

        # Step 2: Re-ranking - use CrossEncoder to score and keep top N
        print("[2/3] Re-ranking with CrossEncoder...")
        reranked_results = rerank_chunks(
            query,
            expanded_results,
            reranker,
            top_k=FINAL_CONTEXT_CHUNKS,
        )
        print_results(reranked_results)

        # Step 3: Generate answer - send top N to LLM
        print("[3/3] Generating answer from LLM...")
        final_answer = ask_llm(query, reranked_results)
        print("\nFinal answer:")
        print(final_answer)


if __name__ == "__main__":
    main()
