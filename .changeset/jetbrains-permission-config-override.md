---
"@kilocode/cli": patch
"@kilocode/kilo-jetbrains": patch
---

Respect `permission` settings from global and project `kilo.jsonc` in the JetBrains plugin. Edits now follow your configured `permission.edit` value instead of being forced to ask, and the Auto-Approve settings page reflects the effective level.
