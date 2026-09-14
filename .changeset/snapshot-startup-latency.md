---
"@kilocode/cli": patch
"kilo-code": patch
---

Start the first snapshot of a new worktree several times faster. Seeding now reuses the checkout's index state instead of re-hashing every file, snapshot preparation reconciles the working tree before the first prompt arrives, and repacking snapshot objects waits until the snapshot repository is idle instead of blocking the tool steps of the running turn.

Delay the replacement of a claimed pre-warmed worktree so its checkout does not compete with the new session's first prompt.
