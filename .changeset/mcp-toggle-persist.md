---
"kilo-code": patch
---

Fix MCP server toggle not persisting to config file — connect/disconnect now update the `enabled` field in the project config so toggle state survives restarts.
