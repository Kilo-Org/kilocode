---
"kilo-code": patch
---

Fix tool use failure for providers returning numeric tool call IDs (e.g. MiniMax) by coercing ID to string in the shared stream parser
