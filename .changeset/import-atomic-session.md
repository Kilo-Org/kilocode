---
"@kilocode/cli": patch
---

Make `kilo import` atomic: the session document is validated before the first write and the session, its messages and its parts are written in a single transaction, so a malformed document no longer leaves a partial session behind.
