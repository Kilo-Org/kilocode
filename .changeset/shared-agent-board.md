---
"@kilocode/cli": minor
"@kilocode/sdk": minor
"kilo-code": minor
---

Add opt-in shared agent boards with persistent session history and selective live updates. Enable the board in Experimental settings to share discoveries and advisory warnings between the main agent and its subagents.

Keep background task status available for models without a reasoning variant.

Warn when a direct board post targets a task known to be inactive, without restarting it.

Keep board updates from rewriting earlier conversation messages and avoid repeated history scans. Restore recent warnings when a task resumes. Preserve the parent's model and reasoning settings when background tasks finish.
