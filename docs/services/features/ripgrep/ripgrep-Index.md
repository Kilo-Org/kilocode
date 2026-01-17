# Services - Ripgrep Feature

**Quick Navigation for AI Agents**

---

## Overview

Fast text search service using ripgrep. Provides high-performance file content searching.

**Source Location**: `src/services/ripgrep/`

---

## Components

| Component | Type | Purpose |
|-----------|------|---------|
| RipgrepService | Class | Text search |

---

## Quick Reference

| Operation | Description |
|-----------|-------------|
| Search text | Find text in files |
| Search pattern | Regex pattern matching |
| Filter files | Search specific file types |

---

## Features

- **Fast**: Uses ripgrep (rg) for speed
- **Regex**: Full regex support
- **Filtering**: Filter by file type, path
- **Context**: Show lines around matches

---

## Search Options

| Option | Description |
|--------|-------------|
| pattern | Search pattern (regex) |
| path | Directory to search |
| includes | File patterns to include |
| excludes | File patterns to exclude |
| caseSensitive | Case sensitivity |
| maxResults | Limit results |

---

## Related

- [Search Tools](../../../core/features/tools/search-tools/) - CodebaseSearchTool
- [Code Index](../code-index/) - Semantic search alternative

---

[← Back to Services](../../Feature-Index.md)
