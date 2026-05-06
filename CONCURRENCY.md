# PR #9764 Concurrency Review

Reviewed `origin/main...HEAD` on `review/pr-9764`, focusing on KiloClaw/Kilo Chat message, action, event, optimistic-update, ordering, duplicate, reconnect, and subscription behavior.

## Interaction Model

- The VS Code extension host owns Kilo Chat REST + Event Service WebSocket state in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:57`.
- The webview is mostly a renderer: it posts commands and receives snapshots/diffs through `postMessage` in `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:177`.
- The extension subscribes to one sandbox context plus one active conversation context at a time in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:487`.
- Messages are initially fetched from REST, then updated by WebSocket events; reconnect triggers REST refetch for conversations and active messages in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:713`.
- The TUI has a separate implementation under `packages/opencode/src/kilocode/claw/` with similar event clients but fewer optimistic/reconnect safeguards.

## Findings

### High: Snapshot refreshes can overwrite newer live messages

`refreshActiveMessages()` assigns the REST snapshot directly to `this.messages` after an async fetch:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1033`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1042`

At the same time, `message.created` appends live WebSocket messages to the same array:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:584`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:608`

If a message is created after the REST `listMessages` snapshot is taken but before `refreshActiveMessages()` assigns its result, the newer WebSocket-appended message is lost from local state until another full refresh happens. This can occur during conversation selection, initial auto-select, and reconnect refreshes.

Expected behavior: REST refresh should merge with current state by id and sort, not replace blindly, unless the response is known to be newer than all events already applied.

### High: Action execution events are typed but not handled

The VS Code types include `action.executed`:

- `packages/kilo-vscode/src/kiloclaw/types.ts:156`
- `packages/kilo-vscode/src/kiloclaw/types.ts:193`

But `KiloClawProvider` only handles `action.delivery_failed`, not `action.executed`:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:642`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:951`

This means concurrent action execution by another client/member may not update the UI. Local execution is optimistic, but remote execution appears to depend on a separate `message.updated` event, if the server emits one. Human verification needed: confirm whether kilo-chat always emits `message.updated` after `action.executed`. If not, users can see stale unresolved actions or conflicting local optimistic decisions.

Expected behavior: handle `action.executed` as the canonical action-resolution event, or document that `message.updated` is the only canonical event and remove the unused event type.

### High: Optimistic rollback can erase concurrent server updates

Several mutations snapshot the whole local message or reaction state, apply an optimistic update, and restore the snapshot on failure:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:857`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:877`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:911`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:931`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:951`

If a concurrent WebSocket event arrives while the request is in flight, rollback restores the old snapshot and can remove unrelated changes. Examples:

- User A adds a reaction, User B's reaction event arrives, User A's request fails, rollback removes User B's reaction.
- User A edits a message, the server sends a newer update, User A's request fails, rollback restores stale content.
- User A executes an action, another client resolves it, User A's request fails, rollback can clear the real resolution.

Expected behavior: rollback should undo only the optimistic delta, or refetch the affected message after mutation failure instead of restoring a stale whole-object snapshot.

### High: Out-of-order `message.updated` events can apply stale content

`message.updated` carries `clientUpdatedAt`, but the handler applies updates unconditionally:

- `packages/kilo-vscode/src/kiloclaw/types.ts:135`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:614`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:619`

If many edits or streaming updates are published close together, an older update arriving after a newer update can overwrite newer content. This is especially risky if updates come from multiple producers or different infrastructure paths.

Expected behavior: compare `clientUpdatedAt` or another monotonic server version before applying, and ignore stale updates. Human verification needed: confirm whether Event Service guarantees strict per-message ordering across all publishers, not just within one WebSocket connection.

### High: TUI does not backfill missed events after reconnect

`EventServiceClient` supports reconnect callbacks:

- `packages/opencode/src/kilocode/claw/event-service-client.ts:153`
- `packages/opencode/src/kilocode/claw/event-service-client.ts:210`

But the TUI wrapper never registers `onReconnect()` and does not refresh the active conversation after reconnect:

- `packages/opencode/src/kilocode/claw/client.ts:137`
- `packages/opencode/src/kilocode/claw/client.ts:150`
- `packages/opencode/src/kilocode/claw/client.ts:391`

The VS Code provider does refresh on reconnect:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:510`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:713`

If the TUI WebSocket disconnects while many messages/events are added, it resubscribes but does not fetch missed history. Users can miss messages, status changes, and conversation updates until a manual refresh/select path happens.

Expected behavior: TUI should refetch conversations and active conversation history on reconnect, mirroring VS Code.

### High: TUI conversation selection can show stale messages after rapid switches

The TUI hook writes returned messages without checking whether the selected conversation is still active:

- `packages/opencode/src/kilocode/claw/hooks.ts:107`
- `packages/opencode/src/kilocode/claw/hooks.ts:110`
- `packages/opencode/src/kilocode/claw/hooks.ts:111`

The lower-level client guards status publication but still returns messages for the originally requested conversation:

- `packages/opencode/src/kilocode/claw/client.ts:361`
- `packages/opencode/src/kilocode/claw/client.ts:375`
- `packages/opencode/src/kilocode/claw/client.ts:382`

If a user switches from conversation A to B while A's REST history load is still pending, A's messages can be written into the UI after B is active.

Expected behavior: the hook should verify `chat.activeConversationId() === conversationId` before applying returned messages, or the client should return a stale marker.

### Medium: Message ordering relies on append order for live events

Initial and paged REST results are sorted by ULID:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1038`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1260`

But live `message.created` events append to the current array without re-sorting:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:608`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:147`

Optimistic replacement also preserves the pending message's existing position:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:594`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:152`

The local send queue serializes only local sends per conversation:

- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:117`
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:123`

It does not order remote messages, bot messages, retries, or messages emitted after reconnect. If event delivery order differs from ULID order, the UI can display messages out of chronological order.

Expected behavior: insert/reconcile messages by id and sort by ULID after every create/replacement, or maintain a sorted data structure.

### Medium: Local sends can remain pending indefinitely if the create event is missed

`sendMessage()` creates a pending local message and ignores the REST response's `messageId`:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:823`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:844`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:846`

Reconciliation depends on a later `message.created` event with matching `clientId`:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:594`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:600`

If the POST succeeds but the WebSocket event is dropped, delayed, or filtered due to subscription timing, the message can stay as `pending-*` until a reconnect or full refresh. This is especially visible under high event volume or transient WebSocket problems.

Expected behavior: use the REST response `messageId` to trigger a targeted refresh or immediate pending replacement, while still accepting the WebSocket event as canonical.

### Medium: Conversation list activity updates do not reorder conversations

`conversation.activity` updates `lastActivityAt` but does not sort the conversation list afterward:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:563`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:566`
- `packages/opencode/src/kilocode/claw/client.ts:292`

The webview grouping logic preserves the incoming order within each date bucket:

- `packages/kilo-vscode/webview-ui/kiloclaw/components/ConversationList.tsx:24`
- `packages/kilo-vscode/webview-ui/kiloclaw/components/ConversationList.tsx:38`

If many messages arrive across conversations, active conversations may not move to the top until a full conversation refresh occurs. This can make the sidebar feel stale or incorrectly ordered.

Expected behavior: sort after activity updates using the same ordering as `mergeConversations()` in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1245`.

### Medium: Read-state events are typed but not handled

The event map includes `conversation.read`:

- `packages/kilo-vscode/src/kiloclaw/types.ts:153`
- `packages/kilo-vscode/src/kiloclaw/types.ts:191`

But there is no corresponding handler in `KiloClawProvider`. Selecting a conversation calls `markRead()`:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:747`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1003`

The unread indicator depends on `lastReadAt`:

- `packages/kilo-vscode/webview-ui/kiloclaw/components/ConversationList.tsx:108`
- `packages/kilo-vscode/webview-ui/kiloclaw/components/ConversationList.tsx:111`

If `markRead()` succeeds but the local conversation list is not refreshed, the unread dot may remain visible. With many activity/read events, read state can appear inconsistent.

Expected behavior: handle `conversation.read` for the current user and update `lastReadAt`, or optimistically update `lastReadAt` after `markRead()` succeeds.

### Medium: Initial WebSocket connection failures are hidden from callers

`EventServiceClient.connect()` catches connection errors and schedules reconnect instead of rejecting:

- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:92`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:99`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:103`

`openChatStream()` awaits `events.connect()` and expects auth/connect errors to be thrown:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:381`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:383`

For transient failures, the panel can proceed as ready while not actually connected, relying on later reconnect. For auth failures, `handleAuthFailure()` also returns without throwing:

- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:164`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:171`

Human verification needed: confirm whether the intended UX is "ready but reconnecting" or "error/needs upgrade". As written, the caller's catch block for `WebSocketAuthError` may be unreachable during `connect()`.

Expected behavior: either reject initial fatal/auth failures, or expose connection state explicitly so the UI can show that live events are not connected.

### Low: Repeated load-more-message requests can pile up

The webview sends `loadMoreMessages` whenever scroll is near the top:

- `packages/kilo-vscode/webview-ui/kiloclaw/components/MessageArea.tsx:126`
- `packages/kilo-vscode/webview-ui/kiloclaw/components/MessageArea.tsx:129`
- `packages/kilo-vscode/webview-ui/kiloclaw/components/MessageArea.tsx:133`

The provider has no in-flight guard for message pagination:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:895`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:898`

`mergeMessages()` deduplicates by id, so this is unlikely to corrupt state:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1238`

But under heavy scroll or many messages, it can issue duplicate network requests for the same `before` id. Conversation pagination has a stale-cursor guard; message pagination should likely have a similar in-flight guard.

## Positive Notes

- Local sends are queued per conversation to reduce local send reordering in `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:123`.
- WebSocket context subscriptions are tracked in a set and resubscribed after reconnect in `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:129` and `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:313`.
- VS Code reconnects refetch active messages and conversations, which is the right general approach for non-replayable event streams in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:713`.
- Message pagination merges and deduplicates older pages by id in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1238`.
- Active conversation fetches in the VS Code provider guard against applying results after conversation switches in `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1039`.

## Recommended Fix Order

1. Fix snapshot/live-event merge races by merging REST refreshes with current state instead of replacing.
2. Add canonical event/version handling for `message.updated` and `action.executed`.
3. Replace whole-object optimistic rollback with delta rollback or targeted refetch.
4. Add TUI reconnect backfill and stale-selection guards.
5. Sort messages/conversations after live inserts and activity events.
6. Add in-flight pagination guards for `loadMoreMessages`.
