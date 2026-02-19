---
"kilo-code": patch
---

Security fix: Remove runSlashCommand from auto-approval read-only tools

Slash commands can switch modes and should not be auto-approved as read-only actions. This prevents potential security issues where auto-approval could allow mode switches without user confirmation.
