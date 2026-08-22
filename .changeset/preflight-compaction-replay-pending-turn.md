---
"@kilocode/cli": patch
---

Fix automatic compaction replaying an already-answered prompt (or injecting a synthetic "Continue if you have next steps..." message) when a prior turn's context usage exceeds the model limit. The pending user request is now compacted around and answered directly, and completed turns defer compaction to the next turn instead of spinning into repeated compaction cycles.
