---
"kilo-code": patch
---

Fix mid-turn message handling so a new prompt sent while the assistant is working no longer aborts the in-flight response. The current LLM reply streams to completion, any pending suggestion or question is automatically dismissed, and the new prompt runs immediately after the current step instead of waiting for the entire multi-step turn to finish.
