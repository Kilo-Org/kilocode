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
- `create_session` supports v1 protocol version 1, optional agent/model/orgId,
  and existing contained relative directories. It uses public
  `session.create`, preserves optional `orgId` as metadata, heartbeats the
  created session, and returns v1 `{ protocolVersion: 1, sessionID }`.
  Cloud cloning is explicitly rejected because its deployed import contract is
  a distinct cloud authority.
- Text-only `send_message` calls public `session.prompt`. Its relay success
  response is emitted only after that public call resolves, which is the v2
  durable inbox-admission boundary. A rejected admission returns an error; no
  background prompt is detached or swallowed.
- `send_command` maps only protocol-v1 command/arguments to public
  `session.command`; its model, variant, and messageID extensions are rejected
  rather than discarded. `list_commands` maps public command names and
  descriptions to the v1 response with required empty hints. `interrupt` and
  `session.renamed` use public session APIs after Location verification.
- `packages/kilo-cli/test/remote-session.test.ts` uses a real loopback Bun
  WebSocket plus isolated authenticated v2 host. It verifies the exact relay
  query form, pre-subscription discovery, create response, durable message
  admission before ACK, command list translation, rename, interrupt, and
  unsupported-command rejection. No deployment, account, or upload is used.

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
- V1 attachment materialization, queue drop keyed by legacy message IDs,
  suggestions, hierarchical attach/detach/`exit_cli`, model catalog, and
  cloud clone require distinct source-backed translations or authorities;
  none is approximated.

Host integration must resolve the active validated account on each activation,
construct the authenticated local public client, and pass a separately
configured relay origin (not `account.server`). Deployed relay-version
verification remains outside local fake-server coverage.
