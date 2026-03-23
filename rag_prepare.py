#!/usr/bin/env python3
import json
import os
import sys

from rag_code_search import get_or_build_index


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: rag_prepare.py <folder_path>"}))
        sys.exit(1)

    folder = sys.argv[1]
    if not os.path.isdir(folder):
        print(json.dumps({"error": "Folder not found"}))
        sys.exit(1)

    model, chunks, index, cache_hit = get_or_build_index(folder)
    if not chunks or index is None:
        print(json.dumps({"error": "Failed to prepare chunks/index"}))
        sys.exit(1)

    print(
        json.dumps(
            {
                "ok": True,
                "cacheHit": bool(cache_hit),
                "chunkCount": len(chunks),
            }
        )
    )


if __name__ == "__main__":
    main()
