# Slack/GitHub State Leak Review

## Scope

Reviewed PR `#9764` on `review/pr-9764`, comparing `origin/main...HEAD`, with focus on whether KiloClaw/Slack chat state can leak into GitHub chat state or vice versa.

I found no direct GitHub-specific code paths in the changed KiloClaw client files. That is not reassuring by itself: the PR moves KiloClaw onto generic `chat.kiloapps.io` and `events.kiloapps.io` endpoints using the user's existing Kilo bearer token, so product/sandbox separation appears to depend heavily on server-side enforcement that is not visible in this repo.

## Findings

### High: Chat credentials are now a generic long-lived Kilo token, not KiloClaw-scoped credentials

`packages/kilo-gateway/src/server/routes.ts:585` changed `/claw/chat-credentials` from proxying KiloClaw-specific credentials to returning the user's existing Kilo token plus generic Kilo Chat/Event Service URLs.

Evidence:

- `packages/kilo-gateway/src/server/routes.ts:585` defines `/claw/chat-credentials`.
- `packages/kilo-gateway/src/server/routes.ts:589` says the bearer is the user's existing long-lived Kilo JWT.
- `packages/kilo-gateway/src/server/routes.ts:615` reads `Auth.get("kilo")`.
- `packages/kilo-gateway/src/server/routes.ts:617` returns either the API key or OAuth access token.
- `packages/kilo-gateway/src/server/routes.ts:628` returns `{ token, expiresAt, kiloChatUrl, eventServiceUrl }`.
- `packages/kilo-gateway/src/api/constants.ts:19` sets the default chat endpoint to `https://chat.kiloapps.io`.
- `packages/kilo-gateway/src/api/constants.ts:28` sets the default event endpoint to `wss://events.kiloapps.io`.

How state can leak:

- The returned token is not visibly scoped to KiloClaw, Slack, a sandbox, a conversation, a product, or a set of event contexts.
- The client uses that token for all Kilo Chat HTTP requests in `packages/kilo-vscode/src/kiloclaw/kilo-chat-client.ts:224`.
- The client also uses that token to authenticate WebSocket event-service subscriptions in `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:184`.

What would happen:

- If the Kilo Chat worker accepts this same bearer for GitHub conversations and KiloClaw/Slack conversations, a KiloClaw client can potentially read, mutate, or execute actions against any conversation ID the token can access.
- If GitHub chat also uses the same event-service and auth model, event subscriptions may cross product boundaries unless the worker enforces product/context authorization on every subscribe and event delivery.
- The old KiloClaw credential route likely centralized scoping in the cloud API; this PR removes that visible scoping from the gateway and shifts it to the chat/event workers.

Human verification:

- Confirm whether `chat.kiloapps.io` has separate product/audience claims for GitHub vs KiloClaw/Slack.
- Confirm whether every `/v1/conversations/:id`, `/v1/messages/:id`, and `/execute-action` request validates product, sandbox, conversation membership, and action ownership server-side.
- Confirm whether `events.kiloapps.io` rejects subscription to contexts outside the authenticated product/sandbox.

### High: VS Code accepts arbitrary webview conversation/message/action IDs and forwards them to Kilo Chat

The VS Code provider trusts IDs from the webview and forwards them directly to Kilo Chat mutation endpoints. It does not check that the conversation exists in the current KiloClaw conversation list, belongs to the current sandbox, or is the active conversation before mutating it.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/types.ts:230` defines inbound webview messages with raw `conversationId`, `messageId`, `groupId`, and action decision fields.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:191` forwards `kiloclaw.selectConversation`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:197` forwards `kiloclaw.renameConversation`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:200` forwards `kiloclaw.leaveConversation`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:206` forwards `kiloclaw.sendMessage`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:209` forwards `kiloclaw.editMessage`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:212` forwards `kiloclaw.deleteMessage`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:218` forwards reactions.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:224` forwards `kiloclaw.executeAction`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:233` forwards `kiloclaw.markRead`.

How state can leak:

- A stale, buggy, or compromised webview can send a KiloClaw message containing a GitHub conversation ID.
- The extension host will send it to Kilo Chat with the user's bearer token.
- There is no local guard like `this.conversations.some((c) => c.conversationId === conversationId)` or `conversationId === this.activeConversationId` for high-impact mutations.

What would happen:

- `sendMessage` could post KiloClaw/Slack content into a GitHub conversation if the server accepts the ID.
- `editMessage` or `deleteMessage` could modify a GitHub message if the server accepts the ID/message pairing.
- `executeAction` could approve or reject a GitHub action/permission prompt from the KiloClaw webview if the server accepts the conversation/message/action tuple.
- `markRead`, reactions, rename, and leave could alter GitHub state from the KiloClaw UI.

Human verification:

- Confirm Kilo Chat rejects cross-product conversation IDs even when the bearer token belongs to the same user.
- Add defense-in-depth in the extension host: reject mutations for conversations not in the current KiloClaw list and reject message/action mutations unless the conversation is active and the message is present in `this.messages`.

### High: Repeated VS Code initialization can leave old chat/event clients alive

`init()` can create new `EventServiceClient`, `KiloChatClient`, and `TokenManager` instances without first disconnecting the previous ones. `openChatStream()` overwrites `this.events`, `this.chat`, and `this.tokens`, and appends event handlers to `this.chatSubs`, but cleanup only runs when the panel is disposed or reattached.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:250` starts `init()`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:359` creates a new event-service client.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:369` overwrites `this.events`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:371` creates a new Kilo Chat client.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:379` overwrites `this.chat`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:398` attaches event handlers.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:510` pushes handlers into `this.chatSubs`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:1167` only performs full cleanup on panel cleanup/dispose.

How state can leak:

- The webview sends `kiloclaw.ready` on mount and exposes `retry` as another `kiloclaw.ready` in `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:217` and `packages/kilo-vscode/webview-ui/kiloclaw/context/claw.tsx:225`.
- A reconnect/retry path can leave an old WebSocket subscribed while a new sandbox/token/client is active.
- Old event handlers close over the same provider instance and compare incoming events against mutable provider fields such as `this.sandboxId` and `this.subscribedConversationContext`.

What would happen:

- Events from an old KiloClaw/Slack context can update the current panel if the context string matches current mutable state.
- Duplicate clients can produce duplicate messages, stale message replacements, stale typing indicators, or stale conversation/action status.
- If a previous client was authenticated under a different account/org/product and remains connected, it may continue injecting events into the current provider.

Human verification:

- Repeatedly trigger `kiloclaw.ready` or retry while switching orgs/accounts/sandboxes and check for duplicate WebSockets.
- Confirm `openChatStream()` disconnects old clients and unsubscribes old handlers before assigning new clients.
- Confirm event handlers capture immutable sandbox/conversation context for the client instance instead of reading mutable provider state.

### High: Active conversation/messages can survive a new sandbox/account bootstrap

`loadInitialSnapshots()` refreshes the conversation list and bot status for the current sandbox, but it only auto-selects a conversation if `this.activeConversationId` is null. It does not clear an active conversation that is absent from the refreshed KiloClaw list.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:272` posts ready state using existing `activeConversationId`, `messages`, and `conversationStatus`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:403` loads initial snapshots.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:409` refreshes conversations for `this.sandboxId`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:428` only auto-selects when no active conversation exists.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:432` skips selection if an old `activeConversationId` is already set.

How state can leak:

- If KiloClaw status changes to a different sandbox/account/org, the old active conversation and messages can remain in memory.
- The provider then posts them as part of the new ready state.

What would happen:

- A user can see prior sandbox chat messages under a new sandbox/account state.
- Follow-up actions can target the stale conversation ID using the new token/client.
- If GitHub and KiloClaw share the same Kilo Chat namespace, stale GitHub conversation state could be displayed or mutated from KiloClaw if it was ever selected/loaded through a bad ID.

Human verification:

- Switch org/account/sandbox while a KiloClaw panel is open and verify the active conversation is cleared unless it exists in the refreshed list.
- Confirm the provider clears `messages`, `conversationStatus`, typing state, and active context on bootstrap if the active ID is not in `this.conversations`.

### Medium: Event client dispatches events for any server-sent context, not only subscribed contexts

`EventServiceClient` tracks `activeContexts`, but `handleMessage()` dispatches any event from the server without checking that `m.context` is in `activeContexts`.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:82` stores event handlers.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:83` stores active contexts.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:129` adds active contexts on subscribe.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:136` removes active contexts on unsubscribe.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:275` handles messages.
- `packages/kilo-vscode/src/kiloclaw/event-service-client.ts:285` dispatches by event name without checking `activeContexts.has(m.context)`.
- `packages/opencode/src/kilocode/claw/event-service-client.ts:281` has the same pattern in the TUI copy.

How state can leak:

- Current handlers mostly check context, but the dispatcher does not enforce it centrally.
- Any future handler that forgets a context check will receive cross-context events immediately.
- If the event service sends events for unauthorized or unsubscribed contexts, the client does not reject them.

What would happen:

- Conversation, typing, message, reaction, or action events from another product/context could enter the KiloClaw handler layer.
- With old leaked WebSockets, this increases the chance of stale events mutating current provider state.

Human verification:

- Confirm the event service never sends events outside subscribed contexts.
- Add a client-side `activeContexts.has(m.context)` check before dispatch for defense-in-depth.

### Medium: Action events are under-validated and action execution can diverge across clients

The event types include both `action.executed` and `action.delivery_failed`, but the VS Code provider only handles delivery failures. The delivery failure handler also ignores the payload `conversationId`.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/types.ts:156` defines `ActionExecutedEvent`.
- `packages/kilo-vscode/src/kiloclaw/types.ts:163` defines `ActionDeliveryFailedEvent` with `conversationId`.
- `packages/kilo-vscode/src/kiloclaw/types.ts:193` includes `"action.executed"` in the event map.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:641` handles `"action.delivery_failed"`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:642` receives `ActionDeliveryFailedEvent`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:643` checks only the WebSocket context.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:644` mutates message action blocks by `messageId` and `groupId`.

How state can leak:

- If an action event is delivered on the wrong context, the handler lacks a payload-level `conversationId` check to reject it.
- If another client executes an action, this client may not update because `action.executed` is not handled.
- The UI can continue presenting an already-executed action as available, leading to duplicate or cross-client permission attempts.

What would happen:

- A GitHub action failure event misdelivered onto a KiloClaw context could clear a KiloClaw action's resolved state if message/group IDs match.
- A KiloClaw/Slack client may execute an action that GitHub already resolved if the stale UI still shows it.
- Server-side rejection may prevent final damage, but client-side state can be misleading around permissions.

Human verification:

- Confirm Kilo Chat emits `action.executed` and whether clients are expected to consume it.
- Confirm action execution endpoints enforce product/conversation/message/action membership server-side.
- Add `e.conversationId === this.activeConversationId` checks where action payloads include conversation IDs.

### Medium: Message and typing event payloads often lack conversation IDs, so clients rely entirely on event context correctness

Several event payloads only include message/member IDs and do not carry `conversationId`. The handlers therefore cannot independently verify that the payload belongs to the active conversation.

Evidence:

- `packages/kilo-vscode/src/kiloclaw/types.ts:141` defines `MessageDeletedEvent` with only `messageId`.
- `packages/kilo-vscode/src/kiloclaw/types.ts:142` defines `MessageDeliveryFailedEvent` with only `messageId`.
- `packages/kilo-vscode/src/kiloclaw/types.ts:144` defines `TypingEvent` with only `memberId`.
- `packages/kilo-vscode/src/kiloclaw/types.ts:147` defines reaction events without `conversationId`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:584` handles `message.created`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:613` handles `message.updated`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:625` handles `message.deleted`.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:660` handles reactions.
- `packages/kilo-vscode/src/kiloclaw/KiloClawProvider.ts:680` handles typing.

How state can leak:

- Product/conversation separation depends entirely on the event-service context string.
- If the event service misroutes a payload or a leaked old client dispatches it, the receiving client cannot validate the payload's conversation.

What would happen:

- Messages/reactions/typing from GitHub could appear in KiloClaw if delivered on a KiloClaw context.
- KiloClaw/Slack events could appear in GitHub clients under the same failure mode.

Human verification:

- Confirm event-service context routing is cryptographically/authorization enforced and not just client-selected strings.
- Prefer including `conversationId` in every conversation-scoped event payload and validating it client-side.

### Medium: TUI conversation switching can apply stale message history after a race

The TUI KiloClaw client has a race where selecting conversation A, then quickly selecting conversation B, can return A's messages to the hook after B is active. The lower-level client protects status emission but still returns messages for the originally requested conversation.

Evidence:

- `packages/opencode/src/kilocode/claw/hooks.ts:107` starts `selectConversation`.
- `packages/opencode/src/kilocode/claw/hooks.ts:110` awaits `chat.selectConversation(conversationId)`.
- `packages/opencode/src/kilocode/claw/hooks.ts:111` unconditionally sets `messages` to `result.messages`.
- `packages/opencode/src/kilocode/claw/client.ts:361` sets the active conversation.
- `packages/opencode/src/kilocode/claw/client.ts:363` awaits `loadHistory(conversationId)`.
- `packages/opencode/src/kilocode/claw/client.ts:375` only guards status publication, not returned messages.
- `packages/opencode/src/kilocode/claw/client.ts:382` returns `{ messages: msgs, status }`.

How state can leak:

- This is mostly intra-KiloClaw rather than GitHub-specific, but it demonstrates weak client-side conversation separation.
- If an arbitrary/non-KiloClaw conversation ID can be selected, stale messages can be rendered under the wrong active conversation.

What would happen:

- The TUI can show conversation A's messages while the active selection is conversation B.
- Follow-up user input goes to B because `send()` uses `activeId`, so the user may reply to the wrong conversation after seeing stale context.

Human verification:

- Add an active-ID check before `setMessages(result.messages)` in the hook or return the requested ID from `selectConversation` and validate it before applying.
- Verify rapid conversation switching with slow network responses.

## Overall Risk

The main risk is not an obvious hardcoded GitHub/KiloClaw mix-up in this repo. The risk is that PR `#9764` moves KiloClaw/Slack chat onto generic Kilo Chat and Event Service infrastructure with a generic user bearer token, while the clients continue to trust raw conversation/message/action IDs and rely on server-side context enforcement.

If the cloud workers enforce strict product, sandbox, conversation, action, and event-context authorization, most findings become defense-in-depth bugs. If they do not, Slack/KiloClaw and GitHub chat state can cross boundaries through:

- HTTP mutations using arbitrary `conversationId` / `messageId`.
- WebSocket subscriptions to arbitrary event contexts.
- Stale VS Code clients that keep old event streams alive.
- Stale active conversation/message state surviving a new bootstrap.
- Permission/action events lacking enough client-side validation.
