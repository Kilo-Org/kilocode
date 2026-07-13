---
"@kilocode/cli": patch
"kilo-code": patch
---

Shut down the headless `kilo serve` process automatically when the editor client that launched it exits without a clean signal, preventing orphaned CLI processes.
