# Message Editing & Management

Interactive editing and message management for user-authored messages.

## Location

- [`webview-ui/src/components/chat/ChatRow.tsx`](../../webview-ui/src/components/chat/ChatRow.tsx:1)

## Interactions

- Edit user messages inline with full chat input features
- Delete user messages from conversation
- Click-to-edit on message text
- Mode selector integration during edit
- Image attachment support during edit
- Cancel/Save actions
- Optional timestamp display

## Suggested migration

**Reimplement?** **Partial** (depends on who owns history).

- If Kilo CLI becomes the source of truth for session history, Kilo can’t “just edit/delete locally” anymore; it needs adapter support to express edits as Kilo CLI session operations.
- Recommended approach:
  - Keep the current UI affordances.
  - Implement edit/delete by mapping to Kilo CLI session operations (e.g. revert/undo/fork-from-message + re-run) as part of the extension-host adapter described in [`docs/opencode-core/opencode-migration-plan.md`](docs/opencode-core/opencode-migration-plan.md:1).
- Kilo CLI’s app UI includes session-level undo/redo/fork concepts (see command labels in [`packages/app/src/i18n/en.ts`](https://github.com/Kilo-Org/kilocode/blob/main/packages/app/src/i18n/en.ts:1)), which suggests parity exists at the session-operation layer, but not necessarily “inline edit message text”.
