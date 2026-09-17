---
"@kilocode/cli": minor
---

Add a `require_approval_for_config_edits` setting to control whether the agent must get approval before editing protected config files. It is enabled by default; set it to `false` in your global config to disable the check. Only global config can turn it off, and your regular permission rules still apply.
