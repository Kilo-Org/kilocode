---
"@kilocode/cli": minor
"@kilocode/sdk": minor
"kilo-code": minor
---

Add Claude Code-compatible hooks: run shell commands before and after tool calls, to block a call or send feedback such as lint errors back to the agent. Hooks are read from the global config, and from `~/.claude/settings.json` when Claude Code compatibility is on. In VS Code, view and edit them in the new Hooks tab of the Agent Behaviour settings.
