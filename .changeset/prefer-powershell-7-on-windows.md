---
"@kilocode/cli": patch
"kilo-code": patch
---

Prefer PowerShell 7 over legacy Windows PowerShell 5.1 when running agent commands on Windows. PowerShell 7 installs are now found even when `pwsh` is missing from PATH, Agent Manager setup and run scripts launch pwsh when available, and an explicit `shell` in kilo.json still overrides detection.
