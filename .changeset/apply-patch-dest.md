---
"@kilocode/cli": patch
"kilo-code": patch
---

Refuse an apply_patch add or move when the destination is a different existing file, and keep the file when a move only changes the case of its name. A move whose source was already deleted or moved earlier in the same patch is refused before anything is written.
