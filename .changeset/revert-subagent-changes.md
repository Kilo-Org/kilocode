---
"@kilocode/cli": patch
---

Reverting a session now also restores files recorded by its sub-agent sessions, so edits a delegated task made outside the parent turn are undone with the rest of the turn instead of being left behind.
