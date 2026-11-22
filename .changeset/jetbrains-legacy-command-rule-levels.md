---
"@kilocode/kilo-jetbrains": patch
---

The legacy migration of auto-approval settings now keeps each command at the level the legacy allow and deny lists gave it. A migrated command list becomes a fallback rule that asks, followed by the listed commands, so a listed command keeps its own level and a command that no list names asks. The separate execute permission follows the master auto-approval switch together with the execute setting, so a profile that never auto-approved commands does not start doing so after migration.

A profile that enabled auto-approval without any command list now migrates to no shell rule instead of an allow-all, so shell commands ask after migration unless you add a rule on the Auto-Approve page.
