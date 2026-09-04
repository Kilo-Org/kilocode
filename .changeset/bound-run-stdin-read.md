---
"@kilocode/cli": patch
---

Bound the piped-stdin wait of `kilo run` when the prompt comes from argv, so a launcher-held-open stdin pipe cannot hang the boot.
