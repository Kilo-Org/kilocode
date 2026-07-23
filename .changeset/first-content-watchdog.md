---
"@kilocode/cli": patch
---

Fix CLI agent stream stalls caused by the idle watchdog firing during time-to-first-content. The per-chunk idle watchdog armed on the AI SDK's synthetic `start` part and raced the wait for the first content-bearing part (prompt processing / time-to-first-token) against the same idle window as inter-chunk gaps, so a healthy but slow first response was falsely aborted and immediately retried (regression #12467). The watchdog now bounds the pre-content phase by the provider's configured request `timeout` (falling back to a 5-minute default) and only applies the per-chunk idle window after the first content/tool part. The same first-content-aware split is applied to the lower-level SSE fetch watchdog (`wrapSSE`) so provider-level `chunkTimeout` no longer aborts slow first content, while mid-response stall detection is preserved at both layers.
