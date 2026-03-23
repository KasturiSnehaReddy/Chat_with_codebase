import os
from tree_sitter_languages import get_parser


def build_embedding_text(chunk):
    """Build metadata-rich text for embedding models."""
    parts = []
    file_path = chunk.get("file")
    language = chunk.get("language")
    chunk_type = chunk.get("type")
    name = chunk.get("name")
    content = chunk.get("content", "")

    if file_path:
        parts.append(f"File: {file_path}")
    if language:
        parts.append(f"Language: {language}")
    if chunk_type:
        parts.append(f"Type: {chunk_type}")
    if name and name != "<unknown>":
        parts.append(f"Name: {name}")

    parts.append("Code:")
    parts.append(content)
    return "\n".join(parts)


def extract_function_and_class_chunks(source_bytes, root_node, file_path, language):
    """
    Extract function and class definitions from source code using tree-sitter.
    Supports Python, JavaScript, TypeScript/TSX, and Java.
    """
    chunks = []
    ranges = []

    def decode_node_text(node):
        return source_bytes[node.start_byte:node.end_byte].decode("utf-8", errors="replace")

    def get_name_from_node(node):
        name_node = node.child_by_field_name("name")
        if name_node:
            return decode_node_text(name_node)
        return "<unknown>"

    def get_js_ts_chunks(node):
        if node.type == "class_declaration":
            return [("class", get_name_from_node(node))]

        if node.type in {"function_declaration", "method_definition"}:
            return [("function", get_name_from_node(node))]

        if node.type == "variable_declarator":
            value_node = node.child_by_field_name("value")
            if value_node and value_node.type in {"arrow_function", "function"}:
                return [("function", get_name_from_node(node))]

        return []

    def get_python_chunks(node):
        if node.type == "class_definition":
            return [("class", get_name_from_node(node))]
        if node.type == "function_definition":
            return [("function", get_name_from_node(node))]
        return []

    def get_java_chunks(node):
        if node.type in {
            "class_declaration",
            "interface_declaration",
            "enum_declaration",
            "annotation_type_declaration",
            "record_declaration",
        }:
            return [("class", get_name_from_node(node))]

        if node.type in {"method_declaration", "constructor_declaration"}:
            return [("function", get_name_from_node(node))]

        return []

    def visit(node):
        extracted = []
        if language == "python":
            extracted = get_python_chunks(node)
        elif language in {"javascript", "typescript", "tsx"}:
            extracted = get_js_ts_chunks(node)
        elif language == "java":
            extracted = get_java_chunks(node)

        if extracted:
            code = decode_node_text(node)
            for node_type, node_name in extracted:
                chunks.append(
                    {
                        "content": code,
                        "type": node_type,
                        "name": node_name,
                        "language": language,
                        "file": file_path,
                        "start_byte": node.start_byte,
                        "end_byte": node.end_byte,
                    }
                )
            ranges.append((node.start_byte, node.end_byte))

        for child in node.children:
            visit(child)

    visit(root_node)
    return chunks, ranges


def extract_global_chunks(source_bytes, extracted_ranges, file_path, min_global_chars=100):
    """
    Extract remaining code outside of functions/classes as global chunks.
    """
    if not extracted_ranges:
        text = source_bytes.decode("utf-8", errors="replace").strip()
        if len(text) >= min_global_chars:
            return [{"content": text, "type": "global", "file": file_path}]
        return []

    merged = []
    for start, end in sorted(extracted_ranges):
        if not merged or start > merged[-1][1]:
            merged.append([start, end])
        else:
            merged[-1][1] = max(merged[-1][1], end)

    global_chunks = []
    cursor = 0

    for start, end in merged:
        if cursor < start:
            piece = source_bytes[cursor:start].decode("utf-8", errors="replace").strip()
            if len(piece) >= min_global_chars:
                global_chunks.append({"content": piece, "type": "global", "file": file_path})
        cursor = max(cursor, end)

    if cursor < len(source_bytes):
        piece = source_bytes[cursor:].decode("utf-8", errors="replace").strip()
        if len(piece) >= min_global_chars:
            global_chunks.append({"content": piece, "type": "global", "file": file_path})

    return global_chunks


def enrich_chunks_for_embeddings(chunks):
    """Attach metadata-rich embedding text to each chunk."""
    enriched = []
    for chunk in chunks:
        updated = dict(chunk)
        updated["embedding_text"] = build_embedding_text(updated)
        enriched.append(updated)
    return enriched


def extract_from_python_file(file_path, min_global_chars=100):
    """Extract functions, classes, and global code from a Python file."""
    parser = get_parser("python")

    with open(file_path, "rb") as f:
        source_bytes = f.read()

    tree = parser.parse(source_bytes)
    root = tree.root_node

    fn_class_chunks, ranges = extract_function_and_class_chunks(source_bytes, root, file_path, "python")
    global_chunks = extract_global_chunks(source_bytes, ranges, file_path, min_global_chars=min_global_chars)

    for chunk in global_chunks:
        chunk["language"] = "python"

    return enrich_chunks_for_embeddings(fn_class_chunks + global_chunks)


def extract_from_javascript_file(file_path, min_global_chars=100):
    """Extract functions and classes from a JavaScript file."""
    parser = get_parser("javascript")

    with open(file_path, "rb") as f:
        source_bytes = f.read()

    tree = parser.parse(source_bytes)
    root = tree.root_node

    fn_class_chunks, ranges = extract_function_and_class_chunks(source_bytes, root, file_path, "javascript")
    global_chunks = extract_global_chunks(source_bytes, ranges, file_path, min_global_chars=min_global_chars)

    for chunk in global_chunks:
        chunk["language"] = "javascript"

    return enrich_chunks_for_embeddings(fn_class_chunks + global_chunks)


def extract_from_typescript_file(file_path, min_global_chars=100):
    """Extract functions and classes from a TypeScript/TSX file."""
    ext = os.path.splitext(file_path)[1].lower()
    language = "tsx" if ext == ".tsx" else "typescript"
    parser = get_parser(language)

    with open(file_path, "rb") as f:
        source_bytes = f.read()

    tree = parser.parse(source_bytes)
    root = tree.root_node

    fn_class_chunks, ranges = extract_function_and_class_chunks(source_bytes, root, file_path, language)
    global_chunks = extract_global_chunks(source_bytes, ranges, file_path, min_global_chars=min_global_chars)

    for chunk in global_chunks:
        chunk["language"] = language

    return enrich_chunks_for_embeddings(fn_class_chunks + global_chunks)


def extract_from_java_file(file_path, min_global_chars=100):
    """Extract functions, classes, and global code from a Java file."""
    parser = get_parser("java")

    with open(file_path, "rb") as f:
        source_bytes = f.read()

    tree = parser.parse(source_bytes)
    root = tree.root_node

    fn_class_chunks, ranges = extract_function_and_class_chunks(source_bytes, root, file_path, "java")
    global_chunks = extract_global_chunks(source_bytes, ranges, file_path, min_global_chars=min_global_chars)

    for chunk in global_chunks:
        chunk["language"] = "java"

    return enrich_chunks_for_embeddings(fn_class_chunks + global_chunks)


def extract_from_yaml_file(file_path, min_chunk_chars=20):
    """Extract YAML chunks by top-level keys for Spring configs."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading YAML {file_path}: {e}")
        return []

    chunks = []
    lines = content.splitlines()
    current = []

    def flush_current():
        if not current:
            return
        text = "\n".join(current).strip()
        if len(text) >= min_chunk_chars:
            chunks.append(
                {
                    "content": text,
                    "type": "config",
                    "language": "yaml",
                    "file": file_path,
                }
            )

    for line in lines:
        stripped = line.strip()
        is_top_level_key = (
            stripped
            and not line.startswith((" ", "\t"))
            and ":" in line
            and not stripped.startswith("#")
        )

        if is_top_level_key and current:
            flush_current()
            current = [line]
        else:
            current.append(line)

    flush_current()

    if not chunks:
        full = content.strip()
        if len(full) >= min_chunk_chars:
            chunks.append(
                {
                    "content": full,
                    "type": "config",
                    "language": "yaml",
                    "file": file_path,
                }
            )

    return enrich_chunks_for_embeddings(chunks)


def extract_from_properties_file(file_path, min_chunk_chars=20):
    """Extract Spring .properties config as grouped key-value blocks."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading properties {file_path}: {e}")
        return []

    chunks = []
    block = []

    def flush_block():
        if not block:
            return
        text = "\n".join(block).strip()
        if len(text) >= min_chunk_chars:
            chunks.append(
                {
                    "content": text,
                    "type": "config",
                    "language": "properties",
                    "file": file_path,
                }
            )

    for line in content.splitlines():
        if not line.strip():
            flush_block()
            block = []
        else:
            block.append(line)

    flush_block()

    if not chunks:
        full = content.strip()
        if len(full) >= min_chunk_chars:
            chunks.append(
                {
                    "content": full,
                    "type": "config",
                    "language": "properties",
                    "file": file_path,
                }
            )

    return enrich_chunks_for_embeddings(chunks)


def extract_from_sql_file(file_path, min_chunk_chars=30):
    """Extract SQL chunks by statement boundaries."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading SQL {file_path}: {e}")
        return []

    statements = content.split(";")
    chunks = []

    for stmt in statements:
        cleaned = stmt.strip()
        if len(cleaned) < min_chunk_chars:
            continue
        chunks.append(
            {
                "content": cleaned + ";",
                "type": "query",
                "language": "sql",
                "file": file_path,
            }
        )

    if not chunks:
        full = content.strip()
        if len(full) >= min_chunk_chars:
            chunks.append(
                {
                    "content": full,
                    "type": "query",
                    "language": "sql",
                    "file": file_path,
                }
            )

    return enrich_chunks_for_embeddings(chunks)


def extract_from_json_file(file_path, min_chunk_chars=20):
    """Extract JSON chunks for storage/config documents (including Mongo-style docs)."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    except Exception as e:
        print(f"Error reading JSON {file_path}: {e}")
        return []

    chunks = []
    raw_chunks = content.split("\n\n")
    for raw_chunk in raw_chunks:
        cleaned = raw_chunk.strip()
        if len(cleaned) >= min_chunk_chars:
            chunks.append(
                {
                    "content": cleaned,
                    "type": "document",
                    "language": "json",
                    "file": file_path,
                }
            )

    if not chunks:
        full = content.strip()
        if len(full) >= min_chunk_chars:
            chunks.append(
                {
                    "content": full,
                    "type": "document",
                    "language": "json",
                    "file": file_path,
                }
            )

    return enrich_chunks_for_embeddings(chunks)


def extract_from_readme_file(file_path):
    """Extract README.md content as a single summary chunk (no parsing)."""
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            content = f.read().strip()
        
        if content:
            return enrich_chunks_for_embeddings([
                {
                    "content": content,
                    "type": "summary",
                    "language": "markdown",
                    "file": file_path,
                }
            ])
        return []
    except Exception as e:
        print(f"Error reading README {file_path}: {e}")
        return []


def extract_chunks_from_file(file_path, min_chunk_chars=100):
    """Route file to appropriate chunker based on extension or name."""
    filename_lower = os.path.basename(file_path).lower()
    
    # Check for README files first (case-insensitive)
    if filename_lower.startswith("readme") and filename_lower.endswith(".md"):
        return extract_from_readme_file(file_path)
    
    ext = os.path.splitext(file_path)[1].lower()

    try:
        if ext == ".py":
            return extract_from_python_file(file_path, min_global_chars=min_chunk_chars)
        elif ext == ".js":
            return extract_from_javascript_file(file_path, min_global_chars=min_chunk_chars)
        elif ext in {".ts", ".tsx"}:
            return extract_from_typescript_file(file_path, min_global_chars=min_chunk_chars)
        elif ext == ".java":
            return extract_from_java_file(file_path, min_global_chars=min_chunk_chars)
        elif ext in {".yaml", ".yml"}:
            return extract_from_yaml_file(file_path, min_chunk_chars=max(20, min_chunk_chars // 4))
        elif ext == ".properties":
            return extract_from_properties_file(file_path, min_chunk_chars=max(20, min_chunk_chars // 4))
        elif ext == ".sql":
            return extract_from_sql_file(file_path, min_chunk_chars=max(30, min_chunk_chars // 3))
        elif ext == ".json":
            return extract_from_json_file(file_path, min_chunk_chars=max(20, min_chunk_chars // 4))
        else:
            return []
    except Exception as e:
        print(f"Error parsing {file_path}: {e}")
        return []


def extract_chunks_from_folder(folder_path, min_chunk_chars=100):
    """Recursively extract chunks from all supported file types."""
    all_chunks = []
    supported_exts = {
        ".py",
        ".js",
        ".ts",
        ".tsx",
        ".java",
        ".yaml",
        ".yml",
        ".properties",
        ".sql",
        ".json",
    }

    for current_dir, _, files in os.walk(folder_path):
        # === README.md HANDLING (summary chunks) ===
        for filename in files:
            if filename.lower().startswith("readme") and filename.lower().endswith(".md"):
                readme_path = os.path.join(current_dir, filename)
                readme_chunks = extract_from_readme_file(readme_path)
                all_chunks.extend(readme_chunks)
        
        # === STANDARD FILE HANDLING (code and text) ===
        for filename in files:
            ext = os.path.splitext(filename)[1].lower()
            if ext not in supported_exts:
                continue

            file_path = os.path.join(current_dir, filename)
            file_chunks = extract_chunks_from_file(file_path, min_chunk_chars=min_chunk_chars)
            all_chunks.extend(file_chunks)

    return all_chunks


if __name__ == "__main__":
    folder_path = input("Enter folder path: ").strip().strip('"\'')

    if not folder_path or not os.path.isdir(folder_path):
        print("Please provide a valid folder path.")
        exit(1)

    chunks = extract_chunks_from_folder(folder_path)

    print(f"Total chunks: {len(chunks)}\n")
    for i, chunk in enumerate(chunks[:5], start=1):
        print(f"Chunk {i}")
        print(f"Type: {chunk['type']}")
        print(f"File: {chunk['file']}")
        print(chunk["content"][:150] + "..." if len(chunk["content"]) > 150 else chunk["content"])
        print("-" * 60)
