# Checkpoint & Task Management

**Priority:** P1

CLI-side snapshot service is fully implemented (`packages/opencode/src/snapshot/`). Extension has a settings toggle. What's missing is the management UI.

## Remaining Work

- Checkpoint restore dialogs
- Checkpoint navigation menu / timeline
- Diff viewing between checkpoints
- "See New Changes" buttons to view git diffs for completed tasks
- Integration with CLI session undo/redo/fork operations
- Consider reusing kilo-ui's `MessageNav` component
- Evaluate whether CLI session undo/redo/revert maps to Kilo's checkpoint model or if extension needs its own git-based implementation
