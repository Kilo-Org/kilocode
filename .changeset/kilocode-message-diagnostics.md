---
"@kilocode/cli": patch
---

Log structural diagnostics (message part sequences, tool-call/result pairing, schema issue paths) when the AI SDK rejects an assembled request, instead of failing with a bare `ModelMessage[] schema` error.
