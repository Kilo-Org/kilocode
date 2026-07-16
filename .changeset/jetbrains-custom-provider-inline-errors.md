---
"@kilocode/kilo-jetbrains": patch
---

Fix adding a Custom OpenAI-Compatible Provider silently failing. The dialog now requires at least one model and reports save errors inline so you can correct your input and retry without re-entering the form.
