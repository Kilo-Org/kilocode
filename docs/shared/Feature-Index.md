# Shared Module Features

**Quick Navigation for AI Agents**

---

## Overview

Shared utilities and type definitions used across the extension. Contains message types, mode definitions, tool definitions, and common utilities.

**Source Location**: `src/shared/`

---

## Features

| Feature | Description | Key Files |
|---------|-------------|-----------|
| **[messages](./features/messages/)** | Extension-webview message types | `ExtensionMessage.ts` (22KB), `WebviewMessage.ts` (17KB) |
| **[modes](./features/modes/)** | Mode definitions and types | `modes.ts` (9KB) |

---

## Key Files

| File | Size | Purpose |
|------|------|---------|
| `ExtensionMessage.ts` | 22KB | Extension → Webview messages |
| `WebviewMessage.ts` | 17KB | Webview → Extension messages |
| `modes.ts` | 9KB | Mode definitions |
| `tools.ts` | - | Tool definitions |
| `skills.ts` | - | Skill types |
| `api.ts` | - | API utilities |
| `embeddingModels.ts` | 8KB | Embedding model configs |

---

## Message Types Overview

**ExtensionMessage**: Messages from extension to webview
- Task state updates
- Tool execution results
- Configuration changes
- Error notifications

**WebviewMessage**: Messages from webview to extension
- User actions (approve, reject)
- Configuration updates
- Task commands

---

## Utilities (src/shared/utils/)

| Utility | Purpose |
|---------|---------|
| `escapeHtml.ts` | HTML escaping |
| `exec.ts` | Execution utilities |
| `iterable.ts` | Iterable utilities |
| `requesty.ts` | Request utilities |

---

## Kilocode-Specific (src/shared/kilocode/)

| File | Purpose |
|------|---------|
| `errorUtils.ts` | Error handling utilities |
| `mcp.ts` | MCP type definitions |

---

[← Back to Index](../Index.md)
