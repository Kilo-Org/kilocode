---
"@kilocode/cli": patch
"kilo-code": patch
---

Explain that file checkpoints require Git when a revert cannot restore files. Reverting in a folder that is not a Git repository now shows "File checkpoints require a Git repository" instead of the generic "No file checkpoint was available" notice.
