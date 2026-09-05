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
- Text-only `send_message` calls public `session.prompt`. Its relay success
  response is emitted only after that public call resolves, which is the v2
  durable inbox-admission boundary. A rejected admission returns an error; no
  background prompt is detached or swallowed. `drop_queued_message` only
  accepts a message ID that this adapter recorded after such an admission for
  the same local session, and then calls public `session.inbox.cancel`; it
  never targets arbitrary local inbox IDs.
- `send_command` preflights the location-scoped public command catalog and
  rejects an unavailable name before attempting `session.command`. It maps
  only protocol-v1 command/arguments; model, variant, and messageID extensions
  are rejected rather than discarded. `list_commands` maps public command
  names and descriptions to the v1 response with required empty hints.
  `list_directories` lists one contained canonical directory level, caps its
  directory results at 256, and excludes symlink/junction escapes. `interrupt`
  and `session.renamed` use public session APIs after Location verification.
- `packages/kilo-cli/test/remote-session.test.ts` uses a real loopback Bun
  WebSocket plus isolated authenticated v2 host. It verifies the exact relay
  query form, pre-subscription discovery, create response, durable message
  admission before ACK, contained directory translation and symlink exclusion,
  command preflight, rename, interrupt, transient reconnect, and permanent
  auth-close suppression. No deployment, account, or upload is used.

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
- V1 attachment materialization, suggestions, hierarchical
  attach/detach/`exit_cli`, model catalog, and cloud clone require distinct
  source-backed translations or authorities; none is approximated.

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
