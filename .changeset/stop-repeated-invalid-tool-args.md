---
"@kilocode/cli": patch
---

Stop looping on repeated malformed tool calls. A turn now aborts with an error after three identical invalid-argument failures instead of retrying the same broken tool call indefinitely.
