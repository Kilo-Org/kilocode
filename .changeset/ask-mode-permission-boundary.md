---
"@kilocode/cli": patch
---

Stop broad permission rules from letting Ask and Plan modes change your workspace. Catch-all approvals, the "Allow everything" toggle, and the `<command> *` rules that "Always allow" persists no longer grant these modes shell commands, subagents, notebook edits or other mutating tools, and MCP tools go back to prompting. To opt a single mode in, set `agent.ask.permission` or `agent.plan.permission` instead of a top-level `permission` rule.
