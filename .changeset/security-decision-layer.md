---
"@kilocode/cli": minor
---

Decide automatic approvals by what a command actually does rather than how it is written, so the same action is held the same way whether it arrives as a shell builtin, an inert-looking Git subcommand, a symlinked path, or a renamed interpreter. Off unless KILO_SECURITY_DECISION is set.
