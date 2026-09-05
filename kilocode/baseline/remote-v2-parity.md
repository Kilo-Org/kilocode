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
  `drop_queued_message` only accepts a message ID that this adapter recorded
  after such an admission for the same local session, and then calls public
  `session.inbox.cancel`; it never targets arbitrary local inbox IDs.
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
  names and descriptions to the v1 response with required empty hints.
  `list_directories` lists one contained canonical directory level, caps its
  directory results at 256, and excludes symlink/junction escapes. `interrupt`
  and `session.renamed` use public session APIs after Location verification.
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

- V1 transcript forwarding consumes legacy event names and legacy
  `event.properties` payloads. V2 exposes a different event algebra with
  envelope fields (`id`, `created`, `durable`, `location`) and different
  message/part event names and payloads. No relay consumer schema is present
  in this source tree to validate a translation. The adapter therefore sends
  heartbeat state but deliberately does not claim status-only forwarding is a
  usable transcript stream.
- V1 permission replies include an optional `interactive` approval bit;
  public v2 `permission.reply` is `{sessionID, requestID, reply, message?}`.
  V1 questions are `answers: string[][]`, while public v2 forms answer keyed
  fields with `string | number | boolean | string[]`. Mapping either would
  silently discard semantics. They remain unimplemented pending a deployed
  relay consumer contract.
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
  Suggestions, hierarchical attach/detach/`exit_cli`, and cloud clone still
  require distinct source-backed translations or authorities; none is
  approximated.

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

The row remains partial: this is an opt-in control adapter, not a usable legacy
transcript stream. Deployed relay-version verification remains outside these
local tests; native Form/permission translations are separate local work, not
evidence that those public APIs are absent.
