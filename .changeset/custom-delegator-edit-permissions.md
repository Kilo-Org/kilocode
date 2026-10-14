---
"@kilocode/cli": patch
---

Allow custom agents to delegate file edits to subagents without stripping the subagent's configured write permissions. A custom delegator's own `edit` rules, including path-scoped denies such as `edit: { "secrets/**": "deny" }`, now apply only to that agent and no longer constrain the subagents it starts, so use a session-level edit restriction to confine delegated writes. Built-in read-only modes (plan, ask, orchestrator) still block edits in their subagents, and child agents keep their own denials and approval requirements.
