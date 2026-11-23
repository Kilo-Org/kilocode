---
"kilo-code": patch
"@kilocode/sdk": patch
---

Keep prompt submission available when the optional browser MCP status check encounters a transient local-server failure. Retry status reads within the readiness deadline and preserve cancellation while preparing tools.

Remove query strings and user information from local-server error URLs.
