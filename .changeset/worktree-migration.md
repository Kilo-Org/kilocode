---
"kilo-code": minor
---

Migrate worktree creation from CLI to extension for parallel mode sessions

- New `WorktreeManager` handles worktree lifecycle in `.kilocode/worktrees/`
- New `AgentTaskRunner` enables agent-driven commits with timeout fallback
- Extension creates worktrees before spawning CLI (CLI is now worktree-agnostic)
- Session resumption properly reuses or recreates worktrees from existing branches
- Worktrees auto-added to `.gitignore` to prevent accidental commits
