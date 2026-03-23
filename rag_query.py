#!/usr/bin/env python3
import sys
import json
import os

from rag_code_search import get_or_build_index, search, rerank_chunks, ask_llm
from sentence_transformers import CrossEncoder


def run_query(folder_path, query):
    # Build or load index
    model, chunks, index, cache_hit = get_or_build_index(folder_path)
    if not chunks or index is None:
        return {"error": "No chunks/index available for folder."}

    # Retrieve
    retrieved = search(query, model, index, chunks, k=15)

    # Try to rerank with a small cross-encoder if available
    try:
        reranker = CrossEncoder("cross-encoder/ms-marco-MiniLM-L-6-v2")
        reranked = rerank_chunks(query, retrieved, reranker, top_k=5)
    except Exception:
        reranked = retrieved[:5]

    # Ask LLM
    answer = ask_llm(query, reranked)

    # Build sources summary
    sources = [{"file": r.get("file"), "snippet": r.get("content")[:400]} for r in reranked]

    return {"answer": answer, "sources": sources}


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"error": "Usage: rag_query.py <folder_path> <query>"}))
        sys.exit(1)

    folder = sys.argv[1]
    query = sys.argv[2]
    if not os.path.isdir(folder):
        print(json.dumps({"error": "Folder not found"}))
        sys.exit(1)

    result = run_query(folder, query)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
