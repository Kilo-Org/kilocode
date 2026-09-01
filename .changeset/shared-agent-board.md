---
"@kilocode/cli": minor
"@kilocode/sdk": minor
"kilo-code": minor
---

Add opt-in shared agent boards with persistent session history and fixed activity notices in tool results. Read peer messages explicitly with `board_read`, without treating them as user requests or approval. Enable the board in Experimental settings to share discoveries between the main agent and its subagents.

Keep background task status available for models without a reasoning variant.

Warn when a direct board post targets a task known to be inactive, without restarting it.

Keep peer content out of user turns and privileged instructions. Coalesce activity notices on genuine tool results, with message bodies available only through explicit reads. Preserve the parent's model and reasoning settings when background tasks finish.
