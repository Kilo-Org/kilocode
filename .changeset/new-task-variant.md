---
"@kilocode/cli": minor
"@kilocode/sdk": minor
---

Add optional `variant` parameter to the `new_task` tool so a calling agent can override the subagent's reasoning level per subtask (e.g. `low`, `medium`, `high`, `xhigh`, `max`). Invalid values return a tool-level error listing the available variants for the target model. When omitted, behavior is unchanged.
