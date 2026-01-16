---
"kilo-code": patch
---

Fix slow CLI termination when pressing Ctrl+C during prompt selection

MCP server connection cleanup now uses fire-and-forget pattern for transport.close() and client.close() calls, which could previously block for 2+ seconds if MCP servers were unresponsive. This ensures fast exit behavior when the user wants to quit quickly.
