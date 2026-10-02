---
"@kilocode/cli": minor
---

Add a `require_approval_for_config_edits` setting to control whether the agent must get approval before editing protected config files. It is enabled by default. A global `false` turns it off everywhere unless a project sets `true`; a project `false` turns it off only for that project's own config files. Your regular permission rules still apply.
