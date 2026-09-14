---
"kilo-code": minor
"@kilocode/cli": patch
---

Speed up Agent Manager worktree creation by pre-warming reusable worktrees and claiming a ready one instead of running a full checkout. Control the pre-warming in Agent Manager settings under "Pre-warm worktrees"; it is enabled by default and uses one extra checkout of disk space per open project.

Prepare snapshots during session creation to reduce first-prompt initialization work. Start no-script sessions after environment files are copied, while preserving setup-script completion before agent startup. Discarded worktrees now remove their checkpoint data instead of leaving it behind.

Resolve the primary checkout with one git call instead of five and discover agents and skills for a new worktree before the first prompt arrives, so the first response starts sooner.
