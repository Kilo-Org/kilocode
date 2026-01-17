# Services Module Features

**Quick Navigation for AI Agents**

---

## Overview

High-level feature services for Kilocode. Contains MCP support, code indexing/embeddings, user skills, browser automation, and various utility services.

**Source Location**: `src/services/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[mcp](./features/mcp/)** | Model Context Protocol (70KB hub) | `McpHub.ts`, `McpServerManager.ts` |
| **[code-index](./features/code-index/)** | Code embeddings and semantic search | `embedders/`, `cache-manager.ts` |
| **[skills](./features/skills/)** | User-defined skills/functions | `SkillsManager.ts` |
| **[browser](./features/browser/)** | Browser automation and web fetching | `BrowserSession.ts`, `UrlContentFetcher.ts` |
| **[tree-sitter](./features/tree-sitter/)** | AST parsing for code analysis | `tree-sitter/` |
| **[terminal](./features/terminal/)** | Terminal command service | `command/` |
| **[checkpoints](./features/checkpoints/)** | Checkpoint service (shadow, repo-per-task) | `ShadowCheckpointService.ts` |
| **[ripgrep](./features/ripgrep/)** | Fast text search | `ripgrep/` |
| **[auto-purge](./features/auto-purge/)** | Auto-purge old data | `AutoPurgeService.ts` |

---

## Other Services (Lower Priority)

| Service | Purpose |
|---------|---------|
| `commit-message/` | Generate commit messages |
| `contribution-tracking/` | Track user contributions |
| `settings-sync/` | Sync settings |
| `stt/` | Speech-to-text |
| `marketplace/` | Extension marketplace |
| `continuedev/` | Continue.dev integration |
| `kilo-session/` | Session management |
| `glob/` | File globbing |

---

## Key Entry Points

| Purpose | File Path |
|---------|-----------|
| MCP Hub | `src/services/mcp/McpHub.ts` |
| Code indexing | `src/services/code-index/` |
| Skills | `src/services/skills/SkillsManager.ts` |

---

[← Back to Index](../Index.md)
