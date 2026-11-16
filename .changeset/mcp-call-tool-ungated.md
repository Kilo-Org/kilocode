---
"@kilocode/cli": patch
---

`POST /experimental/mcp/call-tool` no longer needs `KILO_EXPERIMENTAL_MCP_APPS`: plugins and other authenticated clients can call a tool on a connected MCP server without the MCP Apps flag. The MCP Apps UI and resource reads stay behind the flag.
