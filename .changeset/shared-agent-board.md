---
"@kilocode/cli": minor
"@kilocode/sdk": minor
"kilo-code": minor
---

Introduce Kilo Swarm, an opt-in shared board scoped to a main session and its task descendants, with persistent session history and fixed activity notices in tool results. Enable Kilo Swarm in Experimental settings for parallel solution attempts or complementary work, not every task. Post messages with `board_post` and read peer messages explicitly with `board_read`, without treating them as user requests or approval. Posting a message does not guarantee delivery or reading, or start an agent. Keep `experimental.shared_agent_board`, tool names, stored identifiers, history, and permissions unchanged.

Keep background task status available for models without a reasoning variant.

Warn when a direct board post targets a task known to be inactive, without restarting it.

Keep peer content out of user turns and privileged instructions. Coalesce activity notices on genuine tool results, with message bodies available only through explicit reads. Preserve the parent's model and reasoning settings when background tasks finish.
