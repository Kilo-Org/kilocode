---
"kilo-code": patch
---

Fix isolated Extension Development Host launch on Windows when VS Code is installed under a path that contains spaces. Prefer `Code.exe` over `code.cmd`; keep a cmd shell only for leftover batch shims.
