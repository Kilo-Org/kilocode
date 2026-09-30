---
"kilo-code": patch
"@kilocode/cli": patch
---

Report revert failures instead of failing silently. A failed revert or redo now shows an error toast, and the snapshot steps behind it log the git exit code and stderr when they give up.
