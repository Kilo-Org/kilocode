# PR #9764 Test Review

## Overall Assessment

PR #9764 is a large KiloClaw chat migration from Stream Chat to Kilo Chat/Event Service, but it adds no meaningful tests for the new chat stack. The only changed test files are formatting-only or unrelated small edits, while the new risk is concentrated in WebSocket lifecycle, token refresh, optimistic message state, conversation selection, REST request construction, and webview message reduction.

The current test coverage is not sufficient to catch likely regressions in this PR.

## Findings

### High: No tests cover the new KiloClaw migration path

The PR rewrites the core KiloClaw behavior across the VS Code extension and TUI, but no KiloClaw-specific tests were added. Searches for `KiloClaw`, `kiloclaw`, `EventServiceClient`, `KiloChatClient`, and `createClawChat` in test files returned no matching tests.

Relevant changed files:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:179`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:67`
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:64`
- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:21`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:88`
- `packages/opencode/src/kilocode/claw/client.ts:137`
- `packages/opencode/src/kilocode/claw/hooks.ts:66`

Why this matters:

- This PR changes the transport protocol, message model, auth/token handling, conversation model, and UI state synchronization.
- Regressions here would likely break the user-facing chat panel entirely.
- The changed tests under `packages/opencode/test/kilocode/` are unrelated to KiloClaw and mostly formatting-only.

Recommended improvement:

- Add focused KiloClaw tests before merging.
- Prefer local fake HTTP/WebSocket servers over broad mocks so tests exercise request construction, WebSocket events, reconnects, and async state transitions.
- Minimum useful coverage should include initial load, conversation selection, send/optimistic reconciliation, failed send rollback, typing expiry, token refresh, auth failure, and cleanup.

### High: `EventServiceClient.connect()` behavior is high-risk and untested

`connect()` catches `connectOnce()` failures and schedules reconnects instead of propagating errors to callers.

Relevant code:

- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:92`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:99`
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:164`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:381`
- `packages/opencode/src/kilocode/claw/event-service-client.ts:91`

Potential issue for human verification:

- `KiloClawProvider.openChatStream()` wraps `await events.connect()` in a `try/catch` expecting `WebSocketAuthError` to route to `needsUpgrade`, but `connect()` appears to handle auth failures internally and return successfully.
- If true, the provider may continue bootstrapping after an auth/policy rejection and show a misleading ready state or only a toast.

Recommended tests:

- Auth-close handshake (`1008`, `4401`, `4403`) should either reject from `connect()` or have an explicit tested contract that the provider handles.
- Transient close before open should not mark the UI ready until a connection succeeds.
- Reconnect should resubscribe active contexts and call `onReconnect()` only after a previous successful connection.
- `disconnect()` should cancel handshake timeout, reconnect timer, ping timer, and not reconnect afterward.

### High: VS Code provider state transitions are complex and untested

`KiloClawProvider` now owns a large state machine: initialization, token fetch, Event Service subscription, conversation selection, optimistic updates, reactions, actions, typing timers, pagination, polling, bot nudges, and cleanup.

Relevant code:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:250`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:300`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:510`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:723`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:815`
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1167`

Likely regressions not caught today:

- Duplicate listeners or sockets after repeated `kiloclaw.ready`.
- Stale async responses overwriting a newer active conversation.
- Optimistic message reconciliation failing when `clientId` is present.
- Failed sends/edit/reaction/action not rolling back correctly.
- Leaving the active conversation not clearing all associated status/typing state.
- Cleanup not clearing timers or subscriptions.

Recommended improvement:

- Extract the provider's pure state transitions into a small controller/reducer that can be tested without a full VS Code mock.
- Keep VS Code-specific tests thin: verify inbound webview messages call the controller and outbound messages are posted.
- Use fake clients with controllable promises/events only at the boundary; avoid duplicating the provider's logic inside mocks.

### Medium: HTTP client request behavior is worthwhile but untested

`KiloChatClient` constructs many REST calls and implements per-conversation send queues, auth error handling, query parameters, JSON body handling, and error formatting.

Relevant code:

- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:78`
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:117`
- `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:210`
- `packages/opencode/src/kilocode/claw/kilo-chat-client.ts:1`

Recommended tests:

- Use a local HTTP server, not mocked `fetch`, to assert actual method/path/query/body/headers.
- Verify `Authorization: Bearer <token>` is sent for every request.
- Verify `sendMessage()` serializes sends per conversation but allows different conversations to proceed independently.
- Verify the send queue cleans up after both success and failure.
- Verify 401/403 calls `onUnauthorized` and throws `KiloChatApiError` with parsed body details.
- Verify 204 responses return `undefined` without trying to parse JSON.

### Medium: Token cache behavior is high-value and easy to test

`TokenManager` is small but critical: it caches credentials, deduplicates inflight fetches, applies a freshness buffer, and has a retry cooldown.

Relevant code:

- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:21`
- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:48`
- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:52`
- `packages/kilo-vscode/src/kiloclaw/token-manager.ts:73`

Recommended tests:

- Concurrent `get()` calls share one backend `chatCredentials()` call.
- Cached token is reused until within the freshness buffer.
- `clear()` forces a refetch.
- Missing fields produce a useful error.
- Recent failure triggers cooldown and does not hammer the backend.
- API-token placeholder expiry does not accidentally force refresh loops.

These tests can use a tiny fake `KiloClient` object; this is an acceptable boundary fake because the code under test is the token cache behavior.

### Medium: Webview message reducer has meaningful behavior but no tests

The webview context applies provider messages and filters conversation-specific updates by active conversation. This is exactly the type of logic that catches UI regressions cheaply.

Relevant code:

- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:109`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:139`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:177`
- `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:213`

Recommended tests:

- Initial `kiloclaw.state` populates ready state.
- Messages for inactive conversations are ignored.
- `messageOptimistic`, `messageReplaced`, and `messageRemoved` update the message list correctly.
- `activeConversation` clears typing members.
- `kiloclaw.error` shows a toast but does not overwrite state.
- `retry()` posts `kiloclaw.ready`.

These can be tested with DOM `MessageEvent`s and a stubbed `acquireVsCodeApi()`, not network mocks.

### Medium: TUI KiloClaw client behavior is untested

The TUI has its own wrapper and Solid hook for the same Kilo Chat/Event Service protocol.

Relevant code:

- `packages/opencode/src/kilocode/claw/client.ts:137`
- `packages/opencode/src/kilocode/claw/client.ts:241`
- `packages/opencode/src/kilocode/claw/client.ts:312`
- `packages/opencode/src/kilocode/claw/client.ts:361`
- `packages/opencode/src/kilocode/claw/hooks.ts:154`

Recommended tests:

- `selectConversation()` subscribes to the new context and unsubscribes the old one.
- `message.created` and `message.updated` only affect the active conversation.
- `senderCache` preserves bot/user classification for `message.updated`.
- Typing state expires and is cleared on conversation switch.
- Sending with no active conversation creates and selects a conversation first.
- Cleanup disconnects Event Service and stops typing timers.

Prefer testing `connect()` with a local fake Event Service + HTTP server. For the Solid hook, keep tests at the hook boundary and avoid mocking the internal implementation.

### Low: Existing changed tests do not increase confidence in this PR

Changed test files:

- `packages/opencode/test/kilocode/cleanup.ts:1`
- `packages/opencode/test/kilocode/indexing-startup.test.ts:67`
- `packages/opencode/test/kilocode/permission/next.reply-http.test.ts:125`
- `packages/script/tests/check-opencode-annotations.test.ts:218`

These changes are formatting-only or unrelated to the new KiloClaw behavior. They are fine to keep, but they should not be considered coverage for the chat migration.

## Mocking Guidance

Avoid tests that only mock `EventServiceClient`, `KiloChatClient`, and then assert provider internals. That would duplicate the implementation and miss protocol regressions.

Better approach:

- Use a local HTTP server for Kilo Chat REST endpoints.
- Use a local WebSocket server for Event Service behavior.
- Use fake clocks for typing timeout, reconnect backoff, token freshness, and bot nudges.
- Use a small VS Code/webview shim only where VS Code APIs are the boundary.
- Extract pure helpers or a controller from `KiloClawProvider` so most state behavior can be tested without heavy mocks.

## Suggested Minimum Test Set Before Merge

1. `EventServiceClient` handshake/auth/reconnect/resubscribe/disconnect tests.
2. `KiloChatClient` request construction, auth error, and send queue tests.
3. `TokenManager` cache, inflight dedupe, malformed response, and cooldown tests.
4. `KiloClawProvider` initial ready state, active conversation switching, optimistic send reconciliation, failed send rollback, leave active conversation cleanup, and disposal.
5. `ClawProvider` webview context message reducer tests for active-conversation filtering and optimistic message updates.
6. TUI `connect()` tests for active context filtering, typing expiry, and auto-create-on-send behavior.
