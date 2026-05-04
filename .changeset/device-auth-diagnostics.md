---
"@kilocode/cli": patch
---

Sign-in failures now report the request URL, status, server message, request id, and a hint for likely causes (rate limit, backend unavailable, network error) instead of a bare "Failed to initiate device authorization: 500".
