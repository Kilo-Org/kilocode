---
"kilo-code": patch
---

Move worktree file revert diff status checks into the VS Code extension host so Kilo no longer asks the CLI server to run git diff commands through Bun during workspace and Agent Manager reverts.
