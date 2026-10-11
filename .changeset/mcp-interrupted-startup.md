---
"@kilocode/cli": patch
---

Stop MCP servers from piling up when a request is cancelled while they are still starting. Servers that had already started are now shut down, and the next request starts MCP again instead of failing until the backend restarts.
