---
"@kilocode/cli": patch
---

Restore same-worktree sub-agent changes and show every restored file when reverting, moving the revert point, or redoing a turn. Preserve child work before a partial revert, keep discarded edits from returning, and support redo after deleting a child session. Summarize restored files with one full diff, report busy children as recoverable errors during cleanup, and remove obsolete revert metadata.
