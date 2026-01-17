# Tools - Search Tools

**Quick Navigation for AI Agents**

---

## Overview

Code and file search tools. Enable AI to find code, search files, and list directory contents.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| CodebaseSearchTool | Semantic codebase search | `CodebaseSearchTool.ts` | 9KB |
| SearchFilesTool | Search for files by pattern | `SearchFilesTool.ts` | - |
| ListFilesTool | List directory contents | `ListFilesTool.ts` | - |

---

## CodebaseSearchTool

**Purpose**: Semantic search across codebase using embeddings

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| query | string | Yes | Search query |
| path | string | No | Limit to path |

**Requires**: Code indexing enabled (see [code-index](../../../../services/features/code-index/))

---

## SearchFilesTool

**Purpose**: Find files matching pattern

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| pattern | string | Yes | Glob pattern |
| path | string | No | Base directory |

---

## ListFilesTool

**Purpose**: List files in a directory

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | Directory path |
| recursive | boolean | No | Include subdirectories |

---

## Related

- [Code Index Service](../../../../services/features/code-index/) - Embedding-based search
- [Ripgrep Service](../../../../services/features/ripgrep/) - Fast text search

---

[← Back to Tools](../tools-Index.md)
