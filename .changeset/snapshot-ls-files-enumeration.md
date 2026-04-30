---
"@kilocode/cli": patch
---

Speed up Snapshot.track() on very large repos by letting git enumerate and deduplicate modified and untracked files in a single subprocess call.
