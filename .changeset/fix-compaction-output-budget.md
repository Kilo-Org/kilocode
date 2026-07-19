---
"@kilocode/cli": minor
"@kilocode/sdk": minor
---

Add `outputBudget` config for compaction preflight to prevent early auto-compaction.

Preflight compaction was using the full model output limit (65k) to calculate usable context, even though compaction summary generation only needs ~8k tokens. This caused auto-compaction to trigger ~15% earlier than configured (at ~79% instead of 90% threshold).

Changes:
- Added `outputBudget` field to compaction config schema (default: 8192)
- Added `compactionUsable()` function that uses compaction summary budget instead of full output limit
- Preflight now uses `compactionUsable()` instead of shared `usable()`
- Gains ~57k usable context (~15%) before auto-compaction triggers

Fixes #12196 (HY3 compaction stopping at 73% context).