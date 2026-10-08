---
"@kilocode/cli": patch
---

Keep slash commands working when a plugin or your config defines a command named `goal`. Such a command clashes with Kilo's own `/goal` and used to hide every slash command, including `/init`, `/review`, and your own, leaving autocomplete empty. The clashing command is now skipped and reported as a configuration warning, so the CLI, VS Code, and JetBrains all tell you which command was ignored and why, while the rest keep working. A command list that fails to load also shows a warning in the CLI instead of silently showing no commands.
