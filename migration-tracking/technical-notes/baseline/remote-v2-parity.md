# Remote-session v2 parity boundary

This is a source-backed boundary for the Kilo Sessions relay. It does not
authorize a production relay connection or reuse the unrelated Cloud Agent
transport.

## V1 contract evidence

- `/remote` controls the Kilo Sessions WebSocket relay, not Cloud Agent:
  `origin/main:packages/opencode/src/cli/cmd/remote.ts`,
  `origin/main:packages/opencode/src/kilocode/kilo-commands.tsx`, and
  `origin/main:packages/opencode/src/kilo-sessions/kilo-sessions.ts`
  (`enableRemote`, `disableRemote`, `remoteStatus`).
- V1 dials
  `KILO_SESSION_INGEST_URL ?? "https://ingest.kilosessions.ai"` as
  `/api/user/cli?token=<token>&connectionId=<uuid>`; the envelope definitions
  are in `origin/main:packages/opencode/src/kilo-sessions/remote-protocol.ts`.
  Relay enablement is token-based. `orgId` is optional only on v1
  `create_session`, so a personal account is valid.
- `origin/main:packages/opencode/src/kilo-sessions/remote-sender.ts` accepts
  `create_session`, `list_models`, `list_commands`, `list_directories`,
  `send_command`, `send_message`, `interrupt`, queue drop, questions,
  suggestions, permissions, and `exit_cli`. It forwards arbitrary legacy Bus
  events as `{ type: "event", event, data: event.properties }` after
  session-id extraction.

## Implemented v2 adapter

`packages/kilo-cli/src/remote-session.ts` is Kilo-owned and accepts only an
explicit relay URL, bearer token, and host-injected authenticated
`OpenCodeClient`. It neither reads credentials/environment/account state nor
calls the Cloud Agent or shared-session gateway.

- Each open, lifecycle transition, subscribe, unsubscribe, and ten-second
  tick sends a heartbeat from public `client.session.list(...)`, not just the
  subscribe set. It filters to the plugin Location. Busy/idle is reconciled
  from public `client.session.active()`; the real v2
  `session.execution.started|succeeded|failed|interrupted` events make that
  reconciliation immediate. There is no assumed `session.status` publisher.
- The connection retains its v1 UUID across transient reconnects, buffers at
  most 200 outbound frames, and retries once per close with one-second
  exponential backoff capped at 60 seconds. Auth/conflict closes
  (`4401`, `4403`, `4409`) clear buffered frames and stop retries. Direct
  adapter installation returns a read-only live-socket `connected` handle;
  the ordinary plugin wrapper deliberately does not expose lifecycle state.
- `create_session` supports v1 protocol version 1, optional agent/model/orgId,
  and only the adapter's exact Location. A contained child directory is
  deliberately refused: heartbeat and inbound controls are exact-Location
  scoped, so accepting it would create an invisible remote session. It uses
  public `session.create`, preserves optional `orgId` as metadata, heartbeats
  the created session, and returns v1 `{ protocolVersion: 1, sessionID }`.
  Cloud cloning is explicitly rejected because its deployed import contract is
  a distinct cloud authority. Multi-location remote ownership remains open.
- Text-only and inline-multipart `send_message` call public `session.prompt`.
  Parts must be exactly one text part plus zero or more file parts whose URL
  is a `data:` URL; http(s) URLs (which v1 materialized by fetching), `file:`
  URLs (which would read caller-named local paths), and agent/subtask parts
  are explicitly rejected before any prompt is attempted. Inline parts map to
  public prompt `files` (`uri`, optional `name` from the v1 `filename`); the
  server-side prompt admission owns byte decoding, canonical-base64 and MIME
  validation, and the 20 MB limit, and materializes attachments before durable
  admission, so a rejected attachment produces an error response and admits
  nothing. Its relay success response is emitted only after that public call
  resolves, which is the v2 durable inbox-admission boundary. A rejected
  admission returns an error; no background prompt is detached or swallowed.
  `drop_queued_message` resolves the target from public state only: the command
  session must belong to this adapter's Location, and the ID must be pending in
  that session's real inbox projection or in one of its same-location
  descendants' (the `parentID` walk, matching the root-ID contract for advertised
  child queues). It then calls public `session.inbox.cancel`. Because nothing
  adapter-local gates it, every advertised ID stays cancellable across a restart,
  a resubscribe, or an admission made by another client; a foreign Location, an
  unknown session, and an ID that is no longer pending are all refused with
  `message not queued`. The descendant walk's only bound is the same 8 parent
  edges `subscribedRoot` accepts on the way up, and it follows the listing cursor
  to exhaustion, so the discoverable set equals the set whose queues are
  advertised — a sibling past any single page is still cancellable by root ID.
  The cost is one pending read per descendant, paid only on an explicit
  cancellation or an explicit subscribe/reconnect replay, never per forwarded
  event.
- `list_models` accepts the sessionless instance-picker path and a
  Location-verified session path. It reads only the public
  `model.list`/`model.default`/`provider.list` APIs scoped to the adapter's
  Location and emits the v1 `RemoteModelCatalog.build` wire shape
  (ecccd1f `remote-model-catalog.ts`) with that source's sanitizer bounds:
  names sliced to 256, finite non-negative limits, 32 variants of at most 64
  characters with empty values, 2,048-model truncation flag, zeroed cost,
  empty options/headers/env, `source: "custom"`, and v1 `Provider.sort`
  ordering for the per-provider default. v2 provider/model `settings`,
  `headers`, and `body` are never copied onto the wire. Capability facts are
  limited to what the public API proves: `toolcall` from v2 `tools` and the
  text/audio/image/video/pdf modality booleans from the v2 input/output
  arrays. `currentModel` comes from the session's selected model (variant
  omitted when default); `defaultModel` from `model.default`, both validated
  present in the emitted catalog. A host client without a model catalog gets
  an explicit `model catalog is unavailable` error rather than an
  approximation.
- `send_command` preflights the location-scoped public command catalog and
  rejects an unavailable name before attempting `session.command`. It maps
  only protocol-v1 command/arguments; model, variant, and messageID extensions
  are rejected rather than discarded. `list_commands` maps public command
  names and descriptions to the v1 response with required empty hints and
  advertises `canExitSession: true`, the v1 producer contract every CLI emits
  (ecccd1f remote-command.ts `build()`), on which the deployed consumer gates
  its exit flow. `list_directories` lists one contained canonical directory
  level, caps its directory results at 256, and excludes symlink/junction
  escapes. `interrupt` and `session.renamed` use public session APIs after
  Location verification.
- Every heartbeat advertises `capabilities: { attachments: true }`, the v1
  producer contract the ws layer stamps on every send (ecccd1f remote-ws.ts
  `remote-protocol.ts` Capabilities). The deployed relay spreads it onto each
  `sessions.heartbeat`/`sessions.list` row (cloud origin/main
  UserConnectionDO `handleHeartbeat`/`aggregateSessions`), and the consumer
  enables its remote attachment path only from a row advertising it
  (cloud-agent-sdk `activeSessionSchema` → `publishCapabilities` → the
  mobile fail-closed gate), so the adapter's existing inline-attachment
  `send_message` path becomes consumer-reachable. `protocolVersion` is not
  advertised: no consumer reads the heartbeat field (protocol detection uses
  the `list_models` probe), so no host fact is sourced for it. `sessionClone`
  stays absent while cloud clone is refused — v1's contract is that the flag
  is present only when the CLI accepts the clone, so its absence keeps the
  consumer's clone gate fail-closed.
- Every inbound handler maps public-client rejections to typed errors, so a
  failing call always answers the relay (an error response or silence for
  fire-and-forget system events) instead of dying on an unhandled defect;
  unknown or foreign session IDs answer `session unavailable`.
- `packages/kilo-cli/test/remote-session.test.ts` uses a real loopback Bun
  WebSocket plus isolated authenticated v2 hosts. It verifies the exact relay
  query form, pre-subscription discovery, create response, durable message
  admission before ACK, inline attachment bytes/MIME/name in public history,
  rejection of http(s), `file:`, and oversized inline attachments with no
  admission, the exact v1 catalog wire shape for a config-seeded provider with
  per-provider and catalog defaults, `currentModel`, secret sentinels absent
  from all outgoing frames, durable cancellation of an admitted message while
  its session is busy, foreign-location denial, contained directory
  translation and symlink exclusion, command preflight, rename, interrupt,
  transient reconnect, permanent auth-close suppression, and the explicit
  no-catalog error. No deployment, account, or upload is used.

## Explicit remaining compatibility boundary

The public v2 client does expose session create, permission, and form APIs;
they are not being described as unavailable. The remaining v1 wire shapes do
not map one-for-one yet:

- Transcript forwarding is IMPLEMENTED (accepted R4, `remote-transcript.ts`):
  user/assistant info frames, text/reasoning parts, running/error tool parts,
  and file parts stream as full-value upserts with stable producer-ordinal
  identities. Known recorded gaps: the v1 tool completed state's `title` has
  no v2 source (terminal success never upgrades the running frame), Shell/
  Synthetic/System/Skill messages have no v1 counterpart, and live updates are
  full-value upserts (no delta append frames — idempotency over raw
  streaming).
- Permission asks/replies and question asks/replies/rejections are translated
  (accepted R1/R2; see the next section), as are session status, rename, and
  queue events (R3 lane, `remote-status.ts`). Status, retry, error and rename
  frames are a pure mapping over the durable payloads. The queue lane is not:
  `session.queue.changed` is an authoritative FIFO the consumer reconciles
  wholesale, so every frame — live invalidation and subscribe/reconnect replay
  alike — is a fresh read of the public pending inbox projection
  (`session.inbox.list`, enqueue-ordered, pending rows only). Inbox events only
  invalidate; no local list is ever extended, truncated, or replayed as the full
  queue, so a fresh adapter, a restarted host, an evicted session, and an item
  admitted by another client all advertise the same IDs, and the FIFO is never
  bounded. Queue IDs are the pending user inbox item IDs, which are the IDs
  `session.inbox.cancel` accepts. Reads are ordered by a per-session ticket: a
  read overtaken by a newer one is dropped rather than applied, and the caller's
  epoch/transport guard cancels a read whose subscription ended, so no stale
  snapshot resurrects a delivered or cancelled item. Unchanged snapshots are
  suppressed on the live lane and always re-sent on replay. Both lanes carry the
  same liveness guard (captured epoch, subscription membership, transport
  generation), so a read that outlives its subscription is discarded instead of
  published to a superseded or reconnected consumer. Two consequences worth
  stating: an item that is admitted and delivered before the read completes is
  never advertised as queued, because it genuinely is not pending; and a
  transient pending item can therefore be invisible to the consumer even though
  a v1 host would have shown it briefly — the queue is authoritative, not
  optimistic. Non-user
  inbox work (synthetic, compaction, move) is never advertised. A recovered
  execution re-emits busy (idle→busy across shutdown is explicit). Rename
  forwards `session.updated` with the real title on the wire, but the pinned
  consumer reads only `info.id` and discards the title — no delivered-rename
  claim. Subscribe/reconnect replay covers the subscribed session and its
  same-location descendants over the same 8-hop, cursor-exhaustive `parentID`
  walk the cancellation path uses, so the reconciled set is the set whose live
  queues are advertised; permission/question replay continues to use the
  validated ancestry walk. Recorded limitations of the queue lane: a descendant
  more than 8 parent edges below a subscribed root is neither forwarded nor
  reconciled (the forwarding side has the same bound); a session that moves
  Location mid-walk is excluded per node rather than transactionally; and the
  epoch/transport half of the liveness guard is defence in depth — read ordering
  already prevents stale content, so its only observable effect is suppressing a
  publish whose subscription was superseded, which
  `packages/kilo-cli/test/remote-status.test.ts` covers by frame count.
- V1 send_message `model`/`agent`/`variant` fields and attachments uploaded as
  remote URLs require materialization authorities this adapter deliberately
  lacks; they are rejected rather than approximated.
- Open concern from review, unresolved pending product review: the relay
  `send_message` frame is accepted without an adapter-side bound on the number
  of parts or the aggregate inline data: bytes before the server's per-
  attachment 20 MB decode check. Core still bounds each attachment and
  materializes before durable admission, but no aggregate or part-count cap
  and no canonical data-URL syntax restriction exists at the adapter
  boundary. Adding one is a product-semantics decision, not an approximation
  gap, so it is recorded here instead of implemented.
- The v1 catalog wire model carries capability booleans
  (`temperature`, `reasoning`, `attachment`, `interleaved`) and kilo metadata
  flags (`recommendedIndex`, `isFree`, `mayTrainOnYourPrompts`,
  `hasUserByokAvailable`) with no public v2 source; the adapter omits them
  instead of asserting values. v1 `source` provenance has no v2 public
  equivalent and uses v1's own `"custom"` fallback. `currentModel` has no
  message-history fallback because v2 user messages do not carry a model
  field; the session's selected model is the authoritative v2 source.
  Suggestions are now ported through existing Kilo seams (the slice below);
  cloud clone still requires a distinct cloud authority and is not
  approximated. The v1 attach/detach
  machinery is in-process with no wire surface beyond heartbeat presence and
  `exit_cli`; both sides of that deployed wire contract are translated (the
  heartbeat presence model above and the session-detach slice below).

## exit_cli session detach (implemented)

`exit_cli` is v1's compatibility wire name for session-detach (ecccd1f
remote-sender.ts, K1 W1): verify ownership, cancel the session's active
prompt, stop advertising the session. The deployed consumer gates its exit
flow on the `canExitSession` flag of the parsed `list_commands` catalog
(cloud origin/main cloud-agent-sdk remote-command-catalog.ts and
cli-live-transport.ts `exitSession`, read from the local cloud checkout) and
sends data exactly `{ protocolVersion: 1 }`; the relay (cloud origin/main
UserConnectionDO) forwards the command only with that data shape and a
`sessionId`, routed to the CLI connection whose heartbeat owns the session,
and resolves a pending exit on the CLI's ACK, on its heartbeat dropping the
session, or on its socket closing.

- The adapter's `list_commands` response carries `canExitSession: true` —
  without it the consumer fails closed before the command can ever arrive.
- Ownership is v1's `hasSession` rule: the exact session must resolve in the
  adapter's Location and not already be detached; anything else answers
  `session not owned by this CLI` and leaves presence untouched.
- The active prompt is cancelled by awaiting public `session.interrupt`
  before the detach (a v2 interruption of an idle session is a no-op); a
  failed cancel refuses the ACK (`failed to exit session`) and leaves the
  session advertised, like v1's roll-back path.
- Detach adds the session to a process-local set excluded from every
  subsequent heartbeat, and the fence heartbeat is sent before the ACK, so
  the relay sees the ownership release even if the ACK were lost. Detach
  does not delete or unsubscribe: the session stays resolvable through
  public state and subscriptions remain consumer-driven (v1 detach touches
  presence and pending attaches only).
- No process-exit claim: v2 has no RemoteExit seam, so the adapter follows
  v1's headless path — ACK and keep the host alive; the host keeps
  advertising and can create a new session from zero. A host restart
  re-advertises detached sessions from public state, the same restart
  semantics as the adapter's other process-local state.
- Tests: real loopback relay and gateway fixtures drive exit on a busy
  session (prompt cancelled, `session.active()` drops), invalid-data and
  foreign-session refusals that leave presence untouched, the detached
  heartbeat fence (a heartbeat omitting the session after the last one
  advertising it), public resolvability after detach, and a second exit
  refused by the ownership rule. `list_commands` assertions cover the
  `canExitSession` advertisement. Validation is local-only: loopback
  fixtures plus local reads of the pinned v1 sender and the local cloud
  checkout's relay/SDK sources; the deployed relay and consumer are not
  exercised, so deployed-behavior parity remains the same
  deployment-verification gate recorded for the other lanes.
- Heartbeat capability tests: the fixture asserts the attachment capability
  on the first heartbeat and on the exit fence heartbeat, and that no
  heartbeat frame ever carries `sessionClone` while clone is refused.

## Suggestions port (implemented through existing seams)

v1's `suggest` tool + remote accept/dismiss port through Kilo-owned seams with
zero shared Core edits, using the parent-provided optional gateway tool
capability (kilo-gateway/src/plugin.ts `GatewayContext.tool?: Context["tool"]`;
createGatewayPlugin passes the full plugin Context through at runtime, and
optional keeps minimal catalog hosts valid):

- Producer (`packages/kilo-cli/src/remote-suggestions.ts`): the `suggest` tool
  registers via `ctx.tool.transform` — directly on the plugin context in
  `createRemoteSessionPlugin`, and inside the enabled child Scope in
  `registerRemote` only when the extension context carries the tool capability
  (a disabled or capability-less host exposes no tool). It is a direct
  model-facing tool (`options.codemode: false`, like v1 — never CodeMode-wrapped)
  with v1's `{suggest, actions 1..2}` parameters. `execute` pends on the
  per-enabled-remote holder (`createRemoteSuggestions()` — no global
  singleton), `Effect.onInterrupt` dismisses the pending card when the turn is
  interrupted (v1 abort-listener parity), and the accepted action's prompt is
  admitted exactly once through the public client session API:
  `session.command` dispatch for slash actions (v2's real command path resolves
  the template server-side, replacing v1's resolvePrompt fetch), raw-prompt
  admission for plain actions, and v1's unknown-command fallback admits the raw
  text; dispatch failures after a resolved command fail the tool explicitly.
- Subscriber boundary: remote enabled at the Location does not mean a viewer
  subscribed to every local session. The adapter installs a viewer-eligibility
  accessor on the holder (`setEligibility` — true only while the session is in
  the adapter's validated subscription scope), and the tool runs the awaited
  check inside its own interruptible execution BEFORE the synchronous
  `holder.show` insertion: an ineligible session settles the tool with an
  explicit "not delivered" result, and cancellation during the lookup prevents
  any later insertion (no orphaned visible card can outlive an interrupted
  turn; a holder without an accessor reports ineligible). Reconnect retains
  and replays still-pending cards only for sessions inside that same scope;
  disable and interruption clear pendings unconditionally.
- Request identity: ids are `sug_` + fresh `crypto.randomUUID()` per holder —
  never a process-lifetime counter, so a daemon restart cannot mint the same id
  a resumed session already saw (a stale remote accept then resolves nothing).
- Settle-before-publish: accept resolves the awaiting tool before the accepted
  update is published, and listener callbacks are isolated (one throwing
  listener neither strands the already-removed entry's settle nor skips its
  peers), so a listener failure can never leave a settled suggestion hanging.
- Wire frames: the holder's updates flow through the adapter's sequential event
  stream into consumer-shaped frames — `suggestion.shown`
  `{id (sug_ prefix), sessionID, text, actions[1..2], tool?{messageID, callID}}`
  (cloud origin/main cloud-agent-sdk schemas.ts:722-746 `suggestionShownDataSchema`),
  `suggestion.accepted` `{requestID, index, action}`, `suggestion.dismissed`
  `{requestID}` — each ownership-gated via the adapter's subscribed-root walk
  with descendant frames carrying the subscribed root as `parentSessionId`.
- Commands: `suggestion_accept {requestID, index}` / `suggestion_dismiss
  {requestID}` (v1 ecccd1f remote-sender.ts:50-53, :1263-1299) resolve the
  holder entry after ownership validation: the pending must live in the
  adapter's validated subscription scope and the relay-routed session must be
  the pending's session or its subscribed ancestor. Unknown requestID or an
  invalid index is v1's exact `"suggestion not found or invalid action index"`
  error; dismiss of an unknown id is an idempotent no-op success; a concurrent
  settle between lookup and resolution refuses instead of double-resolving.
- Lifecycle: a newly queued prompt on the session auto-dismisses its pendings
  (v1 SessionPrompt parity, driven by the public `session.inbox.enqueued`
  event); reconnect replays still-pending shown frames for the subscribed
  subtree (v1 replay parity) with terminal invalidation so a settled card is
  never resurrected, and accept idempotence guarantees no duplicate follow-up
  prompt; scope close (disable) rejects every pending. Known difference: the
  session reports busy while a card is pending (v1 faked an idle status via the
  v1-internal SessionStatus service; v2 has no public status override).
- Tests: `test/remote-suggestions.test.ts` drives real loopback host tool
  execution (the scripted model calls `suggest`), the full accept flow with the
  accepted frame and a single admitted follow-up that the model answers,
  duplicate-accept refusal, dismiss + idempotent second dismiss, invalid data,
  invalid index, foreign routed session, queued-prompt auto-dismiss, the
  reconnect replay, the holder-level boundaries (fresh random identity,
  settle-before-publish under a throwing listener, no-eligibility refusal), and
  the unsubscribed-session boundary (a suggest call in an unsubscribed session
  settles promptly with no delivered card while the subscribed flow is
  unaffected). `remote-session.test.ts` regression suites stay green.

`cloneFromKiloSessionId` (retired on the current consumer):

- v1 wire contract (pinned ecccd1f remote-sender.ts `:72-75, :937-1050`):
  `create_session` accepts `cloneFromKiloSessionId`, imports the cloud
  session in-process via `importFromCloud` → `CloudSessionImportInProcess`
  (v1 kilo-sessions.ts `:914-933`), and refuses to fall back to a fresh
  create.
- Current consumer: cloud origin/main `cli-live-transport.ts`
  `buildCreateSessionWireData` (`:44-56`) builds only `{ protocolVersion: 1,
  agent?, model?, orgId? }` — `cloneFromKiloSessionId` appears NOWHERE in the
  current SDK, mobile app, or DO (only unrelated local storage-clone
  helpers). The deployed consumer no longer sends the field, so no
  consumer-supported local gap exists; the adapter's refusal also matches
  v1's "missing importFromCloud seam is a wiring bug, never a fallback"
  posture. If a future consumer reintroduces it, the import authority is the
  deployed cloud backend (`importSessionWithoutRestore` reads the cloud
  session store), which is not locally available.

## Permission and question translation (implemented)

`remote-protocol.ts` mirrors the v1 reply-command data shapes
(`permission_respond`, `question_reply`, `question_reject` — non-strict, from
`ecccd1f remote-sender.ts`), and `remote-session.ts` translates both domains:

- Permission asks: the v2 `permission.asked` event payload is renamed onto the
  retained `PermissionV1.Request` wire shape (`packages/schema/src/v1/
permission.ts`) and validated with that exact schema before sending:
  `action→permission`, `resources→patterns`, `save→always`, tool source
  `id→callID`. The v2 `message` field has no v1 request counterpart and is not
  forwarded. Replied events become `permission.replied` `{sessionID,
requestID, reply}`.
- Questions: only forms the question tool creates translate (`metadata.kind ===
"question"`), and only with v1-renderable fields: `string`-with-options or
  `multiselect`, without `when` visibility conditions. Each question is
  validated against the retained `QuestionV1.Info` schema. The frame id is the
  v2 `frm_` form id — the retained `QuestionV1.ID` brand (`que_`) cannot
  accept it, while the deployed consumer (`cloud-agent-sdk`
  `questionAskedDataSchema`) validates a plain string; the id is therefore
  validated as a non-empty string, not invented. Replies map positional v1
  `answers: string[][]` onto the form's actual field order (`fields[i].key`)
  — no `q${i}` assumption — so field identity is preserved, resolving the
  earlier "would silently discard semantics" concern. Lossy cardinality is
  refused explicitly (multiple labels for a single-select field; answer count
  ≠ field count) and never truncated. Rejections cancel the durable form.
- The `interactive` bit is parsed as explicit v1 wire data and never inferred
  from transport authentication. Approvals (`reply !== "reject"`) of requests
  carrying `metadata.skillShell === true` or `metadata.sandboxEscalation ===
true` are refused without `interactive: true` and the request stays pending,
  mirroring the v1 sensitive gate (`ecccd1f permission/index.ts`). No current
  v2 producer marks that metadata, so the gate is wire-compat defense only —
  documented here rather than claimed as an active protection.
- Subscription ownership: only sessions in the adapter's Location can be
  subscribed; events are forwarded only for subscribed sessions — or sessions
  whose subscribed ancestor is within eight hops, validated by fetching and
  location-checking every ancestor including the subscribed root, so a moved
  intermediate or root invalidates stale membership. Replay derives ancestry
  per pending item through the same validated walk (no whole-listing
  traversal, so the location listing's default page size cannot hide older
  descendants): a pending request or form replays only under the subscription
  owning its nearest subscribed ancestor — the subscribed session itself
  (frames without `parentSessionId`) or that root (frames with it) — and the
  subscribed session must still resolve in the adapter's location, so a moved
  root drops its subtree on replay. A per-session epoch guards
  subscribe/unsubscribe races and duplicates: an immediate unsubscribe
  supersedes the in-flight subscribe and its replay before any frame is sent;
  a duplicate active subscribe (the relay resends on reconnect) is deduped;
  the reconnect replay captures the epoch so a resubscribe cancels it.
  Replies resolve requests through location-scoped listing or direct lookup
  and refuse foreign session/request mismatches with
  `permission request not found`. Each Location runs its own adapter, so
  another location's requests are unreachable from it by construction.
- Replay snapshots are invalidated by terminals per item:
  `permission.replied`, `form.replied`, and `form.cancelled` bump an epoch
  keyed by the resolved request's or form's identity, and a replayed ask for
  that item is dropped — a late `permission.asked` re-adds a stale
  interaction on the deployed consumer (cloud `origin/main`
  `packages/cloud-agent-sdk/src/service-state.ts` `processQuestionAsked` /
  `processPermissionAsked`, dispatch at the event switch), while sibling
  pendings on the same session stay replayable and answerable. The epoch map
  is bounded like the outbound frame buffer.
- Terminal question events gate on the supported question discriminator and
  field shapes (`metadata.kind === "question"` plus v1-renderable fields, no
  `when` conditions): nonquestion control forms (websearch, skill-shell) are
  never emitted as `question.asked`, their replies and rejections are refused
  with `unsupported question form` (they are never cancelled or answered
  through the question path), and `question.replied` is sent only when the
  positional answers are reconstructable — omitted entirely otherwise, since
  v1's replied event requires answers. Question-kind forms with unsupported
  fields are refused on ask, reply, and reject alike.
- Tests: real loopback model sessions drive a shell permission ask (resolved
  by a relay reply), a sensitive refusal (no interactive bit) and its
  interactive approval, replay after unsubscribe/re-subscribe and after
  reconnect (retained connectionId), a duplicate-subscribe dedupe with frame
  counts, same-location descendant replay with the root as `parentSessionId`
  raised while unsubscribed so no live frame masks the replay, a real
  `session.move` of the subscribed root checked against live events and a
  reconnect replay, a moved intermediate with an ambient leaf, a
  terminal-during-replay reject isolated on its own session (a reject
  declines all same-session siblings, so the cascade cannot mask later
  assertions), a same-session two-pending test resolving one noncascade item
  during the replay window (resolved item not replayed, sibling replayed and
  answered through the relay), an immediate subscribe/unsubscribe race, a mismatched
  session/request refusal, question round-trips through the real question
  tool form (single-select + multiselect), cardinality refusal with
  pending-state verification, question rejection cancelling the durable
  form, and nonquestion control forms (created through the public form API
  with a `websearch.provider` discriminator) plus question-kind forms with
  `when` conditions refused on ask, reply, and reject with pending-state
  verification. Emitted permission frames are asserted against
  `PermissionV1.Request` and question frames against `QuestionV1.Info`.

## Opt-in host and TUI integration

`remote-plugin.ts` composes directly with the existing in-process
`GatewayExtension`: the adapter needs only its public location/event domains,
not access to a private Core service or a new Gateway token RPC. The ordinary
interactive host registers `kilocode.remote` status/enable/disable methods.
Registration and status are inert. Enable resolves the active validated account
inside the host, supplies an authenticated local client, and starts a child
scope. Disable, credential changes, and host/plugin shutdown close that scope.
Enablement is not persisted. The response distinguishes enabled intent from
the transport's actual `connected` state and never exposes a bearer token.

The relay origin remains separate from `account.server`. Its default is the
source-proven `https://ingest.kilosessions.ai`; explicit loopback launch options
exist for tests. `/remote` displays the current status and the compatibility
limits above; enabling requires confirmation explaining session advertisement
and remote command authority. No test enables a live relay.

`test/remote-rpc.test.ts` exercises the normal host over authenticated HTTP:
no-credential refusal without dialing, real loopback device sign-in without
automatic enablement, one connection after repeated enables, heartbeat and
session-create translation, disable/re-enable, logout-driven closure, and
token-free status/frames/diagnostics. `test/remote-ui.test.tsx` uses the real
renderer and host to verify truthful limitations and that cancelling the enable
dialog leaves the relay untouched and admits no session/model work.

The row remains partial under the compatibility boundaries recorded above.
Transcript, Form/permission, queue, and suggestion translations have local
coverage; deployed relay-version verification remains outside these tests.
