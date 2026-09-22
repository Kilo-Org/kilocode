---
"@kilocode/cli": minor
---

Add a retained-history worktree usage API: `GET /kilocode/worktree/usage/summaries` for cost/time/communication summaries across every worktree in a project, `GET /kilocode/worktree/usage` for a per-model/agent/session breakdown of the routed worktree, and `GET /kilocode/worktree/usage/timeline` for a paginated, content-free timeline of generation, tool, subagent, and communication activity.
