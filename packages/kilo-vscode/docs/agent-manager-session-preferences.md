# Session preferences

Compact design notes for Agent Manager selector state.

---

## Goal

Keep `agent-manager.json` focused on topology while restoring the visible selector state from the durable session stream.

Selectors should feel stable during active work, but stale stored preferences must not override the real session state.

---

## State Sources

| Source | Scope | Role |
|---|---|---|
| `agent-manager.json` | Workspace | Stores topology only, such as worktrees, tabs, groups, and session references. Obsolete preference fields are ignored and dropped on save. |
| Session history | Session | Restores the real model, mode, and variant from the latest user message. |
| `message.model.variant` | Session | Durable source for reasoning effort. |
| Pending choices | Pending tab | Keeps in-memory selections before the first message creates a session. |
| Unsent choices | Session | Keeps in-memory selector changes for an existing session before the next user message is sent. |

---

## Edge Cases

| Case | Expected behavior |
|---|---|
| Restart with obsolete prefs | Ignore stored preference fields and drop them on the next write. |
| Restart with unsent choices | Lose unsent choices because they are memory-only. |
| Pending tab without session | Keep choices by pending tab ID until the session is created or the tab is removed. |
| Existing session with unsent edits | Keep choices by session ID until the next user message persists them. |
| History has multiple user messages | Use the latest user message as the source of truth. |
| History lacks a variant | Fall back to the default reasoning choice for display. |

---

## Recovery Rules

| Rule | Result |
|---|---|
| Load topology | Read only structural Agent Manager data from `agent-manager.json`. |
| Drop obsolete prefs | Do not hydrate selector state from removed preference fields. |
| Recover committed state | Resolve model, mode, and variant from the latest user message in session history. |
| Preserve pending state | Scope pre-session choices by pending tab ID in memory. |
| Preserve unsent state | Scope pre-send choices by session ID in memory. |
| Persist reasoning | Treat `session history -> message.model.variant` as the durable reasoning source. |

---

## Validation Checklist

| Check | Pass condition |
|---|---|
| Fresh pending tab | Selector changes stay on that tab before send. |
| First send | Pending choices become the sent message model, mode, and variant. |
| Existing session | Unsent selector changes stay local until the next user message. |
| Reload window | Real selector state recovers from latest user message history. |
| Full restart | Unsent choices are gone, committed history state remains. |
| Legacy file | Obsolete preference fields are ignored and removed after save. |
