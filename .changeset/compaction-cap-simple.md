---
"@kilocode/cli": patch
---

Cap compaction retries at 3 per turn to prevent infinite busy loops when the model context stays overflowed after compaction
