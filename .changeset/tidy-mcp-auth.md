---
"@kilocode/cli": patch
---

Distinguish static MCP authorization headers from OAuth authentication. Servers with an `Authorization` header can explicitly opt into OAuth with `"oauth": {}`.
