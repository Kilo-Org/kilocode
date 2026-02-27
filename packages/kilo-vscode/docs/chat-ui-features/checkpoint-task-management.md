# Checkpoint & Task Management

**Priority:** P1
**Status:** 🔨 Partial

## What Exists

- `CheckpointsTab` settings toggle to enable/disable snapshot creation before file edits (`config.snapshot`)

## Remaining Work

### Backend / Service

- Checkpoint service with shadow git repo for per-task snapshots
- Restore files only vs restore files + task state
- Safety checks to avoid problematic paths/nested repos
- Evaluate whether CLI session undo/redo/revert maps to Kilo's checkpoint model or if extension needs its own git-based implementation

### Chat UI

- Checkpoint restore dialogs
- Checkpoint navigation menu / timeline
- Diff viewing between checkpoints
- "See New Changes" buttons to view git diffs for completed tasks
- Integration with CLI session undo/redo/fork operations
- Consider reusing kilo-ui's `MessageNav` component (used by the desktop app but not yet by this extension)
