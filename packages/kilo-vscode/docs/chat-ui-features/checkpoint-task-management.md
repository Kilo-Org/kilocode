# Checkpoint & Task Management

Checkpoint restore/navigation and task-level UX actions.

## Location

- Various checkpoint components

## Interactions

- Checkpoint restore dialogs
- Checkpoint navigation menu
- "See New Changes" buttons to view git diffs for completed tasks

## Suggested migration

**Reimplement?** Partial.

- If “checkpoints” are implemented as Kilo-side git snapshots, they can remain a VS Code integration owned by the extension host (still valid under the new architecture).
- If you want to align with Kilo CLI-native session operations (undo/redo/fork/diff), implement adapter support that maps those Kilo CLI session controls into existing Kilo UI affordances (or add new controls).
- Kilo CLI references: session-level undo/redo/fork appear as first-class concepts in the app UI (see command labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilocode/blob/main/packages/app/src/i18n/en.ts:1)) and diff rendering in [`packages/ui/src/components/session-turn.tsx`](https://github.com/Kilo-Org/kilocode/blob/main/packages/ui/src/components/session-turn.tsx:1).
