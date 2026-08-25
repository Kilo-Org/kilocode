---
"@kilocode/cli": patch
---

Fix malformed model tool calls surfacing as "Model tried to call unavailable tool 'invalid'". Unrepairable tool calls now settle into readable feedback so the model can self-correct instead of failing the step.
