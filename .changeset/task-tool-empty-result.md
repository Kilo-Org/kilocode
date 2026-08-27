---
"@kilocode/cli": patch
---

Fix the task tool intermittently returning an empty result. Subagents that ran with memory context had a synthetic marker part appended after their answer, which was picked up as the final text part and surfaced as an empty `<task_result>` to the parent agent. The task tool now ignores synthetic, ignored, and empty text parts, and background jobs no longer let an empty run overwrite an earlier successful result, so resumed tasks keep their real output.
