# Tools - File Tools

**Quick Navigation for AI Agents**

---

## Overview

File operation tools for reading, writing, and editing files. These are the most commonly used tools in Kilocode.

**Source Location**: `src/core/tools/`

---

## Tools

| Tool | Purpose | File | Size |
|------|---------|------|------|
| ReadFileTool | Read file contents | `ReadFileTool.ts` | 32KB |
| WriteToFileTool | Create/overwrite files | `WriteToFileTool.ts` | 11KB |
| EditFileTool | Edit file sections | `EditFileTool.ts` | 12KB |
| SearchAndReplaceTool | Search and replace | `SearchAndReplaceTool.ts` | 9KB |
| SearchReplaceTool | Alternative search/replace | `SearchReplaceTool.ts` | 9KB |
| ListFilesTool | List directory contents | `ListFilesTool.ts` | - |

---

## ReadFileTool

**Purpose**: Read file contents with token budget awareness

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | Absolute file path |
| encoding | string | No | File encoding (default: utf-8) |

**Behavior**:
1. Validates path exists
2. Checks file size against token budget
3. Reads with specified encoding
4. Truncates if exceeds budget

---

## WriteToFileTool

**Purpose**: Create new files or overwrite existing

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | Target file path |
| content | string | Yes | File content |

**Behavior**:
1. Creates parent directories if needed
2. Writes content to file
3. Returns success/failure

---

## EditFileTool

**Purpose**: Edit specific sections of a file

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | File path |
| oldText | string | Yes | Text to find |
| newText | string | Yes | Replacement text |

**Behavior**:
1. Reads current file content
2. Finds oldText (must be unique)
3. Replaces with newText
4. Writes updated content

---

## SearchAndReplaceTool

**Purpose**: Search and replace with regex support

**Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| path | string | Yes | File path |
| pattern | string | Yes | Search pattern (regex) |
| replacement | string | Yes | Replacement string |
| flags | string | No | Regex flags (g, i, m) |

---

[← Back to Tools](../tools-Index.md)
