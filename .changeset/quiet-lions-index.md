---
"@kilocode/kilo-indexing": patch
---

Reduce codebase indexing memory and disk growth: scans no longer walk ignored directories such as `node_modules`, and the LanceDB index is compacted periodically instead of pruning every prior version on each write.
