---
"@kilocode/cli": patch
---

Reclaim disk space after session cleanup: the session database now shrinks on disk once a cleanup pass frees enough pages, instead of keeping the old file size forever.
