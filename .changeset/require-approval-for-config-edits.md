---
"@kilocode/cli": minor
---

Add a `require_approval_for_config_edits` setting to control whether the agent must get approval before editing protected config files. It is enabled by default and can be scoped per project: a project value applies to that project's own files, while the global value applies to global config directories and protected config targets outside the project. Your regular permission rules still apply, and shell commands or scripts can still modify files.
