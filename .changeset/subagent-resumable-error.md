---
"@kilocode/cli": patch
---

Surface the resumable `task_id` when a subagent stops on an error. Both foreground and background subagent failures now tell the parent agent that the session can be resumed via the task tool with `task_id="<id>"`, so a stopped subagent can be continued instead of being lost.
