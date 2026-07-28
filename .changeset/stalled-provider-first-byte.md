---
"@kilocode/cli": patch
---

Bound the wait for a provider's first response byte by the request timeout. A provider that accepts a request and returns headers but never sends body data now fails and retries instead of leaving the turn hanging after a tool call completes. The same `timeout` value now covers both the connection phase and the wait for the first byte as a single deadline; streaming responses that have already produced data are unaffected.
