---
"@kilocode/cli": patch
---

Expand `{env:VAR}` in the headers of MCP servers from legacy `mcpServers` files instead of sending the literal text. Project `.kilo/mcp.json` and `.kilocode/mcp.json` servers with variable references in headers are skipped with a warning, matching project `kilo.json`.
