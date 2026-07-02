---
"@kilocode/cli": minor
---

Add `mcpConfig.file` to load MCP servers from a shared external file (such as a canonical `.mcp.json` in the standard `mcpServers` format) instead of duplicating server definitions under `mcp`. Accepts a single path or a list, resolves relative paths from the project root, and lets inline `mcp` entries override servers from the file by name.
