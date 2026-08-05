---
"@kilocode/cli": patch
---

Add a privacy mode that blurs PII in the TUI (personal balance, Kilo Pass usage, etc.) and requires confirmation before `/profile` reveals email, name, balance, and team. Toggle with the new `/privacy` command or by setting `privacy_mode` in `kilo.json`. The `kilo profile` CLI command is unaffected.