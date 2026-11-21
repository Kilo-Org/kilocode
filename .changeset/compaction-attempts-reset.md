---
"@kilocode/cli": patch
---

Long turns no longer stop with "Compaction exhausted" after their third successful compaction; only compactions in a row that do not let the model complete a step count toward the cap.
