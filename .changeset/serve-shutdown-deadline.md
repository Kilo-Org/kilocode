---
"@kilocode/cli": patch
---

Force `kilo serve` to exit after five seconds if graceful shutdown stalls, so editor shutdown cannot leave the backend running indefinitely.
