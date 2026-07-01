---
"kilo-code": patch
---

Fix plan files under `.kilo/plans/` being incorrectly blocked from reads — broad read allow rules for plan files are no longer downgraded by config dir hardening.
