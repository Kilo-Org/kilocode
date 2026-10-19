---
"@kilocode/cli": minor
"@kilocode/sdk": minor
"kilo-code": minor
---

Add Claude Code-compatible hooks: run shell commands on agent events to block risky tool calls, send lint errors back to the agent, add context to prompts and new sessions, keep the agent going until a check passes, or get notified when Kilo is waiting for you. Supports the Claude Code tool, prompt, session, subagent, compaction and notification events, plus Kilo hooks for goals, wakeups, worktree setup and teardown, commit messages and branch names. Hooks are read from the global config, and from `~/.claude/settings.json` when Claude Code compatibility is on, so Claude Code hooks such as `Stop`, `SessionStart` and `UserPromptSubmit` now run in Kilo too; set `KILO_DISABLE_CLAUDE_CODE_HOOKS=1` to turn them off. In VS Code, view and edit hooks in the Hooks tab of the Agent Behaviour settings.
