---
"kilo-code": patch
---

Fix Anthropic 400 errors caused by trailing assistant messages. Requests could end with an assistant turn containing only a thinking block, producing "The final block in an assistant message cannot be `thinking`" or "This model does not support assistant message prefill". Outbound message arrays are now sanitized after conversion so they never end with an assistant turn.
