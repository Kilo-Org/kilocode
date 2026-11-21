---
"@kilocode/cli": patch
---

Fix MCP sign-in for servers that only require authorization for tool calls, such as Socket: `kilo mcp auth` now opens the OAuth flow instead of reporting success without credentials, and reports a clear error when a server offers no way to sign in.
