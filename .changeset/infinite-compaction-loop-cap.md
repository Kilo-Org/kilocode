---
"@kilocode/cli": patch
---

Fix an infinite "busy" loop that could occur when a model kept reporting context overflow after every compaction. Each turn now caps compactions at three attempts and closes the turn with a visible context-overflow error instead of silently looping forever.
