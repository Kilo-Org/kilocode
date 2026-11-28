---
"@kilocode/cli": patch
---

Keep codebase indexing working when the Kilo embedding catalog contains an invalid entry. Previously one model without a dimension discarded the whole catalog and left indexing disabled.
