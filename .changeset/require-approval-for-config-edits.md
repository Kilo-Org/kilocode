---
"@kilocode/cli": minor
---

Add a `require_approval_for_config_edits` setting to control whether the agent must get approval before editing protected config files. It is enabled by default. Set it to `false` in project config to turn it off for that project's own config files, or in global config to turn it off for global config directories and config files outside the project. Your regular permission rules still apply.
