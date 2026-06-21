---
"kilo-code": patch
---

Fix MiMo and other OpenAI-compatible models throwing errors when thinking is disabled — properly handles `reasoning: { effort: "none" }` by remapping to `reasoning: { enabled: false }`.
