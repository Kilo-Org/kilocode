---
"@kilocode/cli": patch
"kilo-code": patch
---

Show a "Compaction queued" notice in the VS Code chat while a compaction waits for the running turn, and ignore repeated `/compact` requests while one is already queued so the first summary is no longer summarized again.
