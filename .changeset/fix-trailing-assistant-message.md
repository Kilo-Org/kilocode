---
"kilo-code": patch
---

Fix Anthropic 400 errors caused by malformed trailing assistant messages. Conversion could emit a final assistant turn whose only content was a thinking block, producing "The final block in an assistant message cannot be `thinking`". Outbound message arrays are now sanitized after conversion: empty trailing assistant turns are dropped and a surviving turn is never left ending on a thinking block. Turns carrying real output are always preserved.
