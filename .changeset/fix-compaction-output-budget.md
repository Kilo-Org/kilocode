---
"@kilocode/cli": minor
"@kilocode/sdk": minor
---

Auto-compaction now triggers at the configured threshold instead of ~15% earlier.

Previously, preflight compaction reserved the full model output limit (65k tokens) even though compaction summary generation only needs ~8k. This caused auto-compaction to fire at ~79% context instead of the configured 90% (e.g., 314k vs 371k on a 396k model).

Now conversations can use ~15% more context before auto-compaction kicks in.

Fixes #12196 (HY3 compaction stopping at 73% context).