---
"@kilocode/kilo-jetbrains": patch
---

The legacy migration of auto-approval settings now keeps each command at the level the legacy allow and deny lists gave it. A migrated command list becomes a fallback rule that asks, followed by the listed commands, so a listed command keeps its own level and a command that no list names asks. The execute permission follows the master auto-approval switch together with the execute setting, so a profile that never auto-approved commands does not start doing so after migration.

The migration report now says when a selected category was not applied: an allow list that could not be carried over, and an execute setting the master switch kept from taking effect.
