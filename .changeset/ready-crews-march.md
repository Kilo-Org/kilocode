---
"kilo-code": patch
---

The output of MCP tools is now truncated if its estimated size exceeds 20% of the context window. This prevents confusing error messages about context condensing failure. The user is warned when truncation occurs.
