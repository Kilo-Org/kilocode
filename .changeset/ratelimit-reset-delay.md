---
"@kilocode/cli": patch
---

Wait out the advertised rate-limit window on 429 retries: honor `x-ratelimit-reset-requests` (and similar reset headers, or the "try again in 9s" message) instead of retrying into the limit via exponential backoff.
