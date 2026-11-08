---
"@kilocode/cli": patch
---

`kilo mcp auth` now starts the OAuth sign-in for remote MCP servers that accept an anonymous connection but advertise OAuth protected-resource metadata, such as Google Workspace MCP servers, instead of reporting success without storing credentials.
