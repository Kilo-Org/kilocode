---
"@kilocode/kilo-indexing": patch
---

Support OpenAI-compatible indexing endpoints that reject the optional `dimensions` parameter when their native vectors match the configured size. Report a clear error when the endpoint returns a different vector size.
