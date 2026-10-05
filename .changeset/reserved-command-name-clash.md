---
"@kilocode/cli": patch
---

Keep slash commands working when a plugin, your config, or an MCP server defines a command named `goal`. Such a command clashes with Kilo's own `/goal` and used to hide every slash command, including `/init`, `/review`, and your own, leaving autocomplete empty. The clashing command is now skipped with a warning in the log, and the rest keep working. A command list that fails to load also shows a warning in the CLI instead of silently showing no commands.
