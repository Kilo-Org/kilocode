# Remote and sharing — next implementation contracts

Consultation audit, 2026-09-06. Read-only except this file. Scope: the frozen
accepted batch in this worktree is untouched; no task transitions, commits,
installs, fetches, credentials, or live relay/share traffic. Sources, all read
locally: this checkout (`kilo-v2` at `61a8707c03` plus the frozen dirty batch),
Kilo v1 pinned `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` (`git show`), and the
sibling cloud checkout `/Users/johnnyamancio/Workspace/kilo_workspace/cloud`
(clean worktree at `c32be17d6`; its `origin/main`
`08c4887fa68738f19089284101084f404eb6c9b8` read through local git objects only).
Sharing and remote are kept distinct throughout. The accepted remote
alias/admission and inline-attachment slice is not re-audited.

## 1. New consumer-contract evidence (remote line)

`kilocode/baseline/remote-v2-parity.md` records transcript forwarding and
permission/question translation as blocked because "no relay consumer schema is
present in this source tree to validate a translation." That boundary is now
sharpened: the consumer contract exists in the local cloud checkout and is
readable without network.

- Relay frame and forwarding: cloud `origin/main`
  `services/session-ingest/src/types/user-connection-protocol.ts` —
  `CLIOutboundMessageSchema` accepts `{ type: "event", sessionId,
parentSessionId?, event: string, data: unknown }`; the CLI's own
  `remote-protocol.ts` shapes are already a strict subset.
  `UserConnectionDO.handleCliEvent` forwards these frames verbatim to
  subscribed web sockets (`WebInboundMessageSchema` re-exposes the same loose
  envelope).
- Deployed consumer validation: cloud `origin/main`
  `packages/cloud-agent-sdk/src/normalizer.ts` — `normalizeCliEvent(eventType,
data)` is documented as the UserConnectionDO consumer entry point and
  validates per-event data schemas in
  `packages/cloud-agent-sdk/src/schemas.ts`:
  `permissionAskedDataSchema` = `{ id: string.min(1), permission: string,
tool?: { callID }, patterns: string[] (catch []), metadata: record (catch
{}), always: string[] (catch []) }`; `questionAskedDataSchema` = `{ id,
tool?: { callID }, questions?: array (catch undefined) }`;
  `messageUpdatedDataSchema` = `{ info: { id, sessionID } }` passthrough;
  `messagePartUpdatedDataSchema` = `{ part: { id, sessionID, messageID } }`
  passthrough; `messagePartDeltaDataSchema` = `{ sessionID, messageID, partID,
field, delta }`; `messagePartRemovedDataSchema` = `{ sessionID, messageID,
partID }`; `sessionStatusDataSchema` = `{ sessionID, status: busy | idle |
retry }`; `sessionIdleDataSchema` = `{ sessionID }`;
  `sessionQueueChangedDataSchema` = `{ sessionID, queued: string[] }`;
  `questionReplied/RejectedDataSchema` and `permissionRepliedDataSchema` = `{
requestID }`.
- Transcript rendering consumes v1 `Message`/`Part` shapes from
  `@kilocode/app-shared/opencode` (`packages/app-shared/src/opencode.gen.ts`,
  the v1 opencode algebra): the SDK chat processor upserts `message.updated`
  info and `message.part.updated` parts into storage keyed by v1 message/part
  identities; the mobile agent-chat screen imports
  `@kilocode/cloud-agent-sdk` (cloud `origin/main` `apps/mobile/src/app/(app)/
agent-chat/[session-id].tsx`).

This is the same evidence class the sharing audit used for the ingest service
(local cloud refs, no deployment proof). It converts the previously open
"consumer unknown" concern into a testable translation target and leaves one
honest residual: whether the deployed relay matches `origin/main` — a
deployment-verification gate of the same class as sharing gate 1, not a local
gap.

## 2. Legacy wire shapes retained in the v2 tree

No cross-repo fixtures are needed for the legacy encoder side; the v2 tree
retains the exact v1 contracts:

- `packages/schema/src/v1/permission.ts` — `PermissionV1.Request` `{ id, 
sessionID, permission, patterns, metadata, always, tool?: { messageID,
callID } }`, `Reply` `once|always|reject` (lines 27-44).
- `packages/schema/src/v1/question.ts` — `QuestionV1.Request` `{ id, sessionID,
questions: Info[], tool? }`, `QuestionV1.Info` `{ question, header, options:
[{label, description}], multiple?, custom? }`, `QuestionV1.Answer` =
  `string[]`, `QuestionV1.Reply` `{ answers: string[][] }` plus
  `Replied`/`Rejected` event shapes (lines 15-56).
- `packages/schema/src/v1/session.ts` — `SessionV1` message/part algebra:
  `partBase { id: PartID("prt_…"), sessionID, messageID }` (81-85),
  `TextPart`, `ReasoningPart`, `ToolPart { callID, tool, state:
pending|running|completed|error, metadata? }` (259-315, 315-324), `User` /
  `Assistant` messages (332-490), `Part` union (486-500).
- `packages/kilo-cli/src/remote-protocol.ts:30-44` — `RemoteEventSchema` (`{
type: "event", sessionId, parentSessionId?, event, data }`) is already in
  `RemoteOutboundSchema`; the adapter simply never emits `event` frames today
  (`packages/kilo-cli/src/remote-session.ts:92-105` subscribes to the v2 event
  stream but only uses it to trigger heartbeats).

## 3. Remote slices, strongest first

### R1 — permission translation (out, in, replay)

Fully mechanical; every field is source-proven on both ends.

Outbound: v2 ephemeral `permission.asked` (data = `Permission.Request.fields`:
`packages/schema/src/permission.ts:25-53`) → legacy event frame
`permission.asked` with `PermissionV1.Request` data:

| PermissionV1 field | v2 source                                                                                    | Ref                     |
| ------------------ | -------------------------------------------------------------------------------------------- | ----------------------- |
| `id`               | `request.id` (`per_…`)                                                                       | permission.ts:10-14, 38 |
| `sessionID`        | `request.sessionID`                                                                          | permission.ts:26        |
| `permission`       | `request.action`                                                                             | permission.ts:27        |
| `patterns`         | `request.resources`                                                                          | permission.ts:28        |
| `metadata`         | `request.metadata ?? {}`                                                                     | permission.ts:30        |
| `always`           | `request.save ?? []`                                                                         | permission.ts:29        |
| `tool`             | `request.source` when `{type:"tool"}` → `{ messageID: source.messageID, callID: source.id }` | permission.ts:16-23     |

The consumer validates this exactly (`permissionAskedDataSchema`), including
the `per_`-prefixed id (min 1, no prefix check). `permission.replied` → legacy
`permission.replied` `{ sessionID, requestID, reply }` (consumer needs
`requestID`).

Inbound: v1 command `permission_respond` with data `{ requestID, reply:
"once"|"always"|"reject", message?, interactive? }` (v1 sender
`remote-sender.ts:44-50,1296-1312`) → public
`client.session.permission.reply({ sessionID, requestID, reply, message? })`
(`packages/protocol/src/groups/permission.ts:117-135`; client input
`packages/client/src/promise/generated/types.ts:5638-5643`). The `interactive`
bit: v1's only consumer is the sensitive-approval gate at
`ecccd1f packages/opencode/src/permission/index.ts:290-307` (refuses
non-interactive approvals of `metadata.skillShell`/`sandboxEscalation`
requests). V2's `Permission.reply` (`packages/core/src/permission.ts:254-310`)
has no interactive field and no sensitive marker gate, and no v2 producer
marks `skillShell` metadata today (`packages/kilo-cli/src/skill-policy.ts` sets
none). The translation must not invent a wire field; the honest options are (a)
parse and ignore the bit as v1 wire compatibility — the relayed reply is
human-originated by transport construction (JWT-authenticated web client), the
same trust position v1 encoded by sending `interactive: true` — or (b) record a
follow-up to give v2's reply API an interactive gate. Option (a) is the local
slice; it is a documented wire-compat drop, not a claim the v1 gate exists.

Replay on subscribe: v1 replayed pending permissions
(`remote-sender.ts:511-553`); v2 source is
`client.permission.request.list` (location-scoped,
`packages/protocol/src/groups/permission.ts:23-36`) or
`client.session.permission.list` (session-scoped, :89-100).

### R2 — question translation (out, in, replay)

The v2 Core already defines the question↔form bridge the adapter needs —
this is what resolves the parity doc's "mapping either would silently discard
semantics" note. The producer convention is `packages/core/src/tool/
plugin/question.ts`: forms carry `metadata: { kind: "question", tool: {
messageID, id } }` (lines 78-81) and one field per question `toField(question,
index)` = `{ key: "q${index}", title: header, description: question, type:
multiple ? "multiselect" : "string", options: [{ value: label, label,
description }], custom: true }` (115-128); answers are read back positionally
from `state.answer["q${index}"]` and normalized to `string[][]` (94-100).

Outbound: v2 ephemeral `form.created` (`{ form: Info }`,
`packages/schema/src/form.ts:160`) with `metadata.kind === "question"` → legacy
`question.asked` with `QuestionV1.Request` data: `id` = `form.id`, `sessionID`
= `form.sessionID`, `tool` = `{ messageID, callID: id }` from
`form.metadata.tool`, `questions[i]` = `{ question: field.description, header:
field.title ?? "", options: field.options.map(o => ({ label: o.value,
description: o.description ?? "" })), multiple: field.type === "multiselect",
custom: field.custom }`. Core's producer never emits the v1 Kilo hint
extensions (`labelKey`, `mode`, `default`), so their omission is faithful, not
lossy. `Form.Info`/`Field` shapes: `packages/schema/src/form.ts:39-133`.

Inbound: `question_reply` `{ requestID, answers: string[][] }` (v1 sender
`remote-sender.ts:31-35,1233-1247`) → `client.session.form.reply({
sessionID, formID: requestID, answer })` where `answer` is built by mapping
each positional answer through the form's actual `fields` order (fetch via
`client.session.form.get`, client paths
`packages/client/src/promise/generated/client.ts:1397-1479`): index i →
`fields[i].key`; multiselect → `string[]` (labels are values by producer
construction); string-with-options → first label; empty → omit (Core reads
missing keys as `[]`). Keys are derived from the form, never assumed `q${i}` —
that is what avoids the silent-semantics discard. `question_reject` `{
requestID }` → `client.session.form.cancel`. Non-question forms (MCP
elicitation and any other `metadata.kind`) stay refused, as today.

Outbound lifecycle: `form.replied` → legacy `question.replied` `{ sessionID,
requestID, answers }` (positional reconstruction from the same field order);
`form.cancelled` → `question.rejected` `{ sessionID, requestID }`. Replay on
subscribe: `client.form.request.list` (location-scoped,
`packages/protocol/src/groups/form.ts:39-53`) filtered to
`metadata.kind === "question"`, matching v1's `replay()`
(`remote-sender.ts:511-530`).

### R3 — status, idle, and queue events

- `session.execution.started` → `session.status` `{ sessionID, status: { type:
"busy" } }`; `session.execution.succeeded|failed|interrupted` →
  `session.idle` `{ sessionID }` plus a `session.status` idle frame;
  `session.retry.scheduled` (`packages/schema/src/session-event.ts:547-558`) →
  `session.status` `{ type: "retry", attempt, message, next }` (attempt/at
  from the event; consumer `sessionStatusDataSchema`). The adapter already
  reconciles busy/idle from `client.session.active()` for heartbeats
  (`remote-session.ts:92-105`); this slice adds the legacy event emission on
  the same subscription.
- `session.inbox.enqueued|delivered|cancelled` (event.ts:188-217) →
  `session.queue.changed` `{ sessionID, queued: string[] }` from the public
  `client.session.inbox.list` (`packages/protocol/src/groups/session.ts:527`),
  emitted on each event and replayed on every (re)subscribe exactly like v1's
  always-sent queue snapshot (`remote-sender.ts:552-562`). Open detail to
  settle while implementing: whether `queued` maps to inbox item IDs or the
  admitted user-message IDs the adapter already records in `admitted`
  (`remote-session.ts:75`) — v1's payload is queued message IDs
  (`sessionQueueChangedDataSchema` says "user-message IDs"), and v2 inbox IDs
  are `SessionMessage.ID`s, so the two are the same identifier family; verify
  against `SessionInbox.Item` at implementation time.
- `session.renamed` (`session-event.ts:102-111`) → `session.updated` `{ info: {
id, title } }` (consumer `sessionUpdatedDataSchema` needs `info.id` only).
- `session.error`-shaped failures: `session.execution.failed` carries `error`
  (event.ts:226-231) → legacy `session.error` `{ sessionID, error }`
  (consumer `sessionErrorDataSchema` tolerant).

### R4 — transcript part streaming (implemented in remote-transcript.ts)

R1/R2 accepted; the slice is implemented in the new Kilo-owned
`packages/kilo-cli/src/remote-transcript.ts` (+ `test/remote-transcript.test.ts`,
minimal `remote-session.ts` dispatch). Every SessionV1 required field maps to a
proven event/projection source; frames with unmapped required fields are never
emitted.

Module shape: new Kilo-owned `packages/kilo-cli/src/remote-transcript.ts` +
isolated `remote-transcript.test.ts`; `remote-session.ts` gains only dispatch
through the existing ownership gates and `send`. Encoder validation once at
emission against the retained `SessionV1` schemas
(`packages/schema/src/v1/session.ts`) via `Schema.decodeUnknownOption`.

Part identity: deterministic ids `prt_${assistantMessageID}_t${ordinal}` /
`_r${ordinal}` / `_c${toolCallID}` — stable across started/delta/ended and
across adapter restarts. Emission is full-value `message.part.updated` upserts
only: `session.part.delta`-style append frames are dropped because the
consumer's `applyPartDelta` appends (cloud `origin/main` chat-processor
`message.part.delta` → `sessionStorage.applyPartDelta`), so redelivered deltas
would duplicate text, while full-value upserts are idempotent
(`upsertPart` replaces by id). Live streaming is preserved by adapter-side
accumulation: each delta updates the running text and re-emits the full
accumulated value; `ended` carries the authoritative text and reconciles any
drift from missed deltas.

Exact field/source matrix:

- Assistant `message.updated` — NOT emittable from `session.step.started`
  alone. `SessionV1.Assistant` requires `time.created`, `parentID` (v1
  MessageID), `modelID`, `providerID`, `mode`, `agent`, `path {cwd, root}`,
  `cost` (finite), `tokens {input, output, reasoning, cache.read, cache.write}`
  (v1/session.ts:453-485). Proven sources:
  - `modelID`/`providerID`/`variant`/`agent` ← `session.step.started`
    `{assistantMessageID, agent, model: Model.Ref}` (session-event.ts:310-321).
  - `cost`/`tokens` ← `session.step.ended` `{cost: Money.USD, tokens:
TokenUsage.Info}` (session-event.ts:334-351; `TokenUsage.Info` matches the
    v1 token shape field-for-field, `total` omitted — optional in v1). So the
    assistant info frame is emittable only at `step.ended` (or `step.failed`
    when its optional cost/tokens are present); parts stream before the info
    frame, which the consumer stores via `upsertPart` keyed by messageID —
    rendering-before-info is a consumer behavior to verify in the cloud repo
    during implementation.
  - `time.created` ← the projected message's `time.created`
    (`SessionMessageAssistant.time.created`) or the event envelope `created`.
  - `parentID` ← the tracked last delivered user-message id (from the fetched
    `session.messages` user message after `session.inbox.delivered`) — a real
    id, not a zero; a step with no tracked predecessor delays the info frame
    until one exists.
  - `path {cwd, root}` ← `cwd` from the adapter's `ctx.location.directory`;
    `root` from the session's project root on `Session.Info.location` — verify
    the exact projection field at implementation.
  - `mode` ← verified producer precedent: the pinned v1 creator sets
    `mode: agent.name` with the same real agent it sets on `agent`
    (kilocode `ecccd1f` `packages/opencode/src/session/prompt.ts` ~1690 and
    ~2352), so v2's `step.started.agent` is the source for both fields; the
    remaining unproven fields are the real `path.root`, message `time`, the
    `parentID` predecessor, and cost/tokens semantics (the v2 projection's
    cost/tokens are optional — the v1 producer initialized them to zeros at
    creation and finalized later; the adapter must not invent that). Prefer
    the current public projection's full-value snapshots over duplicated
    event-side caches where feasible.
- User `message.updated` — `session.inbox.delivered` carries `inboxID` only;
  the adapter fetches via public `client.session.messages`
  (`packages/protocol/src/groups/message.ts:26`); `SessionMessageUser`
  `{id, time.created, text, files?, agents?, skills?}` (generated types
  1692-1701) maps to `SessionV1.User` `{id, sessionID, role: "user",
time.created, agent, model}` — `agent`/`model` on the v1 User message are
  REQUIRED (v1/session.ts:332-354) and have no verified v2 user-message source
  (the session's selected model/agent are adapter-known facts, recorded as the
  candidate mapping to verify). Parts: TextPart from `text`; FileParts from
  `files` (below).
- File parts — in scope, not deferred: remote-admitted v2 user messages
  already carry inline attachments. `PromptFileAttachment`
  `{data: PromptBase64, mime, source, name?, description?}` (generated types
  502-509) → `SessionV1.FilePart` `{mime, filename: name, url:
data:${mime};base64,${data}, source?}` (v1/session.ts:171-176) — the same
  data-URL form the accepted send_message slice admits. `PromptFileSource` →
  `SessionV1.FilePartSource` (`file` path / `symbol` / `resource` variants,
  v1/session.ts:144-169) mapping verified at implementation.
- Tools — `message.part.updated` `SessionV1.ToolPart {callID: id, tool: name,
state}` (v1/session.ts:313-321). `name`: primary source
  `session.tool.input.started` `{id, name}`; recovery after a missed
  input.started from the PUBLIC message projection — `SessionMessageAssistant
.content[]` carries `name` and the full state union
  (`SessionMessageAssistantTool`, generated types 2060-2073), so the adapter
  fetches the projection for an unknown call instead of trusting an
  unpopulated cache. `called` → the v1 running state
  `{status: "running", input: event.input, time: {start: event.created}}` —
  every field source-proven; the event envelope carries a real `created`
  timestamp (schema/event.ts:61). `failed` → the v1 error state with `input`
  from the projection's error state and `error` from the structured error's
  real `message`. BLOCKED, recorded: the v1 completed state requires `title:
string` and no v2 event or projection field supplies it — terminal success
  never upgrades the running frame (the test asserts zero completed upserts).
- Dropped/omitted, recorded: `message.part.delta` frames (redundant under
  full-value upserts; not idempotent on redelivery), `message.part.removed`
  (no v2 producer), Shell/Synthetic/System/Skill messages (no v1 Message
  counterpart), `session.renamed` → `session.updated` (NOT implemented — R3
  was not part of the accepted slice; it belongs to an explicit later slice,
  not "already covered").
- History authority boundary: a relay-only v2 session has no ingest snapshot —
  ingest uploads are the sharing line, and the deployed viewer is v1-only
  today (sharing gate 2). No-backfill therefore means remote-relayed v2
  sessions have NO viewer-side history until the sharing line's viewer work
  lands; live relay frames are the only transcript surface. This dependency
  is recorded rather than assumed covered.
- Tests: a real loopback host drives a text run and a tool run through the
  relay; user, assistant, text, file, and running-tool frames are decoded
  against the retained `SessionV1` schemas (assistant parentID = the tracked
  user message, `path.root` = the public project canonical, real cost/tokens
  from `step.ended`), and zero completed tool upserts prove the recorded
  title gap.

### Still gated for remote (not closable locally)

- Whether the deployed relay/ingest matches cloud `origin/main`'s
  UserConnectionDO and SDK schemas — deployment verification, same class as
  sharing gate 1. Local tests prove frame + consumer-schema compatibility
  only.
- `suggestion.shown`: no v2 producer exists anywhere in this tree (v1's
  Suggestion subsystem has no v2 port; the v2 tool set has no `suggest` tool —
  tool set verified in `kilocode/baseline/cli-remainder-next-gaps.md`). Not
  implementable without inventing one; the consumer would render it, but there
  is no v2 fact to forward.
- `exit_cli`, hierarchical attach/detach, cloud clone: unchanged boundary
  (`kilocode/baseline/remote-v2-parity.md`).
- Aggregate inline-part bound on `send_message`: still the recorded product
  decision; do not close it here.

## 4. Sharing slices (kept distinct from remote)

The five canonical gates stand as quoted in
`plans/kilo-opencode-v2-issue-13750.md:1346-1379`; the local side is already
fail-closed. What source inspection adds:

- Gate 3 (team ownership) has its backend half implemented at cloud
  `origin/main`: `kilo_meta` items are extracted by
  `services/session-ingest/src/dos/session-ingest-extractors.ts`
  (`extractNormalizedOrgIdFromItem`, platform, gitUrl, gitBranch) and the
  `organization_id` write is refused without membership proof —
  `services/session-ingest/src/ingest/metadata.ts:177-211` calls
  `hasOrganizationAccess` and deletes the claim otherwise. The missing half is
  plugin-side: the v2 upload batch built in
  `packages/kilo-gateway/src/session.ts:195-220` emits only `session` +
  `message` items. Emitting `{ type: "kilo_meta", data: { platform,
orgId? } }` from the host's actual validated organization selection (the
  account/selection state the gateway already resolves — never session
  metadata or a guessed default) is a Kilo-owned local slice, testable against
  loopback ingest fixtures. It interacts with the existing fail-closed
  `authorizeShare` team refusal: the org claim is what enables validated team
  ownership once the deployed backend verifies membership; until deployment is
  proven, the refusal stays. Gate 3 still closes only with the deployed
  backend (gates 1/5).
- Gate 2 (public viewer) is cloud-repo work, not this worktree: the viewer at
  `apps/web/src/app/s/[sessionId]/shared-transcript.ts` (audited at cloud
  `origin/main`) requires v1 `message.info.role` and separate parts; v2
  self-contained messages are accepted by ingest storage but dropped by the
  viewer. Implementation belongs to the cloud checkout with its own tests;
  deployment to the target closes the gate.
- Gates 1/4/5 remain non-local: deployment verification, post-share
  synchronization contract, and end-to-end acceptance against the target.

### 4.1 S1 — organization kilo_meta emission (implemented in session.ts)

S1 is implemented locally in `packages/kilo-gateway/src/session.ts` and
`packages/kilo-gateway/test/session.test.ts`:

- Contract alignment: `buildIngestBatch` produces `{ type: "kilo_meta",
  data: { platform, orgId? } }` as the leading item of the ingest batch,
  matching cloud repo `origin/main` `services/session-ingest/src/types/session-sync.ts`
  (`SessionItemSchema`).
- Pure producer and consumed path: `buildIngestBatch` is exposed as the pure
  batch builder and is the exact path invoked by `upload` during snapshot
  ingestion, eliminating dead code. Speculative unconsumed fields (gitUrl/gitBranch)
  are omitted.
- Host-owned validation reuse: organization membership validation is owned by
  the existing host `authorizeShare` callback in `plugin.ts`; `session.ts`
  validates UUID syntax on host selection without duplicating authority or
  introducing unused helpers.
- Fail-closed team share refusal: existing team-share refusal
  (`"Team session sharing is not supported in this preview yet"`) is preserved
  both on `authorizeShare` and in `handlers.share`, preventing any real team
  session upload before deployed backend validation. Stale and non-UUID account
  selections fail closed with `"The selected Kilo account is not available"`
  with zero cloud calls.
- Personal session uploads: personal accounts emit `{ type: "kilo_meta",
  data: { platform: "cli" } }` without `orgId`.
- Local tests (14 passing in `test/session.test.ts`):
  - Ingest batch fixture matches cloud ingester schema under real JSON
    serialization (`JSON.stringify` / `JSON.parse` round-trip).
  - Pure producer helper verified for valid org UUID emission, non-UUID
    rejection, and custom platform overrides.
  - Stale/invalid organization selection refuses share before network requests.
  - Team sharing attempt refuses share with zero backend calls.

### 4.2 Exact remaining sharing gates

1. **Gate 1 (Deployment verification):** Verify target deployment runs the
   newer purpose-bound share token contract and public read route with
   `kilo_meta` extractor support.
2. **Gate 2 (Public viewer v2 support):** Update cloud repo
   `apps/web/src/app/s/[sessionId]/shared-transcript.ts` to render
   self-contained v2 messages instead of dropping them.
3. **Gate 3 (Team ownership backend acceptance):** Client-side S1 emission is
   complete; backend authorization and ownership transition remain gated on
   target deployment acceptance.
4. **Gate 4 (Continuous sync & tombstone contract):** Implement post-share
   incremental synchronization and removal/revert handling once backend
   contract settles.
5. **Gate 5 (Deployed end-to-end acceptance):** Validate deployed behavior
   with an intentionally shareable fixture.

## 5. Minimal ownership proposal — next slice

Implement R1 + R2 together as one slice (permission and question translation);
they share the same seams and tests, and R2 without R1 would leave the relay
answering questions but not permissions.

- Owned paths only:
  - `packages/kilo-cli/src/remote-protocol.ts` — local zod schemas for the
    legacy permission/question event data (mirroring `PermissionV1.Request` /
    `QuestionV1.Request` fields) and the three inbound commands
    `permission_respond`, `question_reply`, `question_reject`; reuse the
    in-tree `PermissionV1`/`QuestionV1` values from
    `@opencode-ai/schema/v1/*` where the export path allows, otherwise mirror
    the shapes locally with provenance comments (no protocol-package changes).
  - `packages/kilo-cli/src/remote-session.ts` — translate the v2 event
    subscription (`permission.asked/replied`, `form.created/replied/cancelled`
    filtered to `metadata.kind === "question"`) into `RemoteEventSchema`
    frames; add the three inbound commands mapping to
    `session.permission.reply` / `session.form.reply|cancel`; replay pending
    permissions and question-forms on `subscribe`; scope everything to the
    adapter Location exactly as existing handlers do
    (`remote-session.ts:238-260`).
  - `packages/kilo-cli/test/remote-session.test.ts` (+ fixture) — extend the
    existing loopback-relay host tests: assert outgoing `permission.asked` /
    `question.asked` frames decode as `PermissionV1.Request` /
    `QuestionV1.Request`; drive a real host form through the question tool
    path and round-trip `question_reply` positional answers into the form's
    keyed reply; assert `question_reject` cancels durably; assert replay
    contents; assert unknown/foreign sessions answer as today. Bundled
    `packages/kilo-cli/dist/interactive/bun`, package-local runs only.
- Explicitly out of the slice: transcript part streaming (R4 — own slice,
  design decisions above must be settled first), suggestions, exit_cli /
  attach/detach / clone, aggregate bound, and any deployment claim. No
  Protocol/Server `HttpApi` change is required, so no `bun run generate`
  surface is touched.
- Do not count this slice as closing the `/remote` row: the ledger's
  transcript-forwarding and deployed-verification boundary remains the row's
  own acceptance, and R1/R2 do not claim it.

Sequencing: R3 is an independent small slice on the same files; R4 is the
substantial one and should land after R1-R3 prove the event-translation
pattern. Sharing slice S1 (kilo_meta emission) is independent of all remote
work and touches `packages/kilo-gateway/src/session.ts` only.
