---
"kilo-code": patch
---

Close read-only bash escapes where allowed commands could still run arbitrary programs via flags (`sort --compress-program`, `rg --pre`, `ag --pager`, `man -P`/`-H`).
