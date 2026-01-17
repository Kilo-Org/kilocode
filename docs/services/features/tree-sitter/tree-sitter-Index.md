# Services - Tree-sitter Feature

**Quick Navigation for AI Agents**

---

## Overview

AST (Abstract Syntax Tree) parsing service using Tree-sitter. Enables code-aware operations like syntax highlighting, code navigation, and intelligent parsing.

**Source Location**: `src/services/tree-sitter/`

---

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| TreeSitterService | Class | Main parsing service |

---

## Quick Reference

| Operation | Description |
|-----------|-------------|
| Parse file | Parse source code into AST |
| Get symbols | Extract functions, classes, etc. |
| Get scope | Determine code scope at position |

---

## Supported Languages

Tree-sitter supports 40+ languages including:
- JavaScript/TypeScript
- Python
- Java
- Go
- Rust
- C/C++
- And many more...

---

## Use Cases

1. **Code Indexing**: Parse code for semantic search
2. **Symbol Extraction**: Find functions, classes, variables
3. **Syntax Analysis**: Understand code structure
4. **Intelligent Editing**: Context-aware modifications

---

## Related

- [Code Index](../code-index/) - Uses tree-sitter for parsing
- [Tools](../../../core/features/tools/) - Some tools use AST info

---

[← Back to Services](../../Feature-Index.md)
