# Cloud CLI v2 parity

Scope: port the v1 (`origin/main`) cloud-client pure protocol surface into the v2
`packages/kilo-cli` tree as Kilo-owned modules, behind an explicit-credential
adapter and a host-side Gateway RPC extension. This document is the parity and
verification ledger for that slice.

## File ownership and provenance

All files are Kilo-owned and new; none edit shared upstream code. Sources are
ported from `origin/main:packages/opencode/src/kilocode/cloud/` (v1, 14 files) at
pinned SHA `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7` (the local `origin/main`
ref at port time). "Byte-port" means the file body is the v1 source with only
import-path rewriting.

| v2 path | v1 source | Port kind |
|---|---|---|
| `src/cloud/contracts.ts` | `cloud/contracts.ts` | Byte-port (zod schemas, `projectStatus`, `resultExitCode`). |
| `src/cloud/errors.ts` | `cloud/errors.ts` | Byte-port. |
| `src/cloud/http.ts` | `cloud/http.ts` | Byte-port. |
| `src/cloud/message-id.ts` | `cloud/message-id.ts` | Byte-port. |
| `src/cloud/origin.ts` | `cloud/origin.ts` | Byte-port of `parseServiceOrigin` and the two origin constants. **Dropped** `resolveCloudAgentOrigin`/`resolveWebAppOrigin`: those read `process.env`, which is host-owned wiring. Origins are injected explicitly instead. |
| `src/cloud/response-json.ts` | `cloud/response-json.ts` | Byte-port. |
| `src/cloud/trpc.ts` | `cloud/trpc.ts` | Byte-port (`createTrpcClient`, `createAgentClient`, `createCloudAgentClient`). |
| `src/cloud/stream-ticket.ts` | `cloud/stream-ticket.ts` | Byte-port. |
| `src/cloud/websocket-stream.ts` | `cloud/websocket-stream.ts` | Byte-port. |
| `src/cloud/client.ts` | — | New. Explicit-credential adapter (`createCloudAdapter`): takes `{token, organizationId?, agentOrigin, webAppOrigin}`; never reads a credential store, env var, or global. Composes the tRPC client, status/result projection + exit-code mapping, and the stream-ticket/WebSocket stream path. |
| `src/cloud-rpc.ts` | — | New. Public Effect RPC wire contract (`CloudRpc.Definition`, id `kilocode.cloud`). Reuses the canonical zod schemas as Standard Schema validators directly; `start`/`send` narrow the message to prompt-only and structurally omit the org override; `stream.prepare` is a small zod pair. |
| `src/cloud-plugin.ts` | — | New. `registerCloud` GatewayExtension; registers the RPC handlers inside the host plugin scope, resolving the account in-host. |
| `test/cloud-transport.test.ts` | `test/kilocode/cloud/transport.test.ts` | Ported; loopback `Bun.serve` tRPC stub. |
| `test/cloud-stream-ticket.test.ts` | `test/kilocode/cloud/stream-ticket.test.ts` | Ported; mock `fetch`. |
| `test/cloud-websocket-stream.test.ts` | `test/kilocode/cloud/websocket-stream.test.ts` | Ported plus new pre-abort/live-abort coverage; injected mock `WebSocket`. |
| `test/cloud-adapter.test.ts` | — | New; adapter seam against loopback stubs. |
| `test/cloud-cli.test.ts` | — | New; real-launch public-RPC tests via `test/cloud-fixture.ts` and `createClient`. |
| `test/cloud-cli-subprocess.test.ts` | — | New; `tui-preview` cloud verb subprocesses via the packaged launcher. |
| `test/cloud-stream-cli.test.ts` | — | New; real loopback WebSocket `cloud start --stream` tests (provided URL, ticket fallback, non-fatal error, SIGINT abort). |
| `test/cloud-fixture.ts` | — | New; launch fixture wiring the cloud extension to loopback stubs via dev origin overrides. |

## Deliberately not ported (host/Auth/Core seams owned by the parent)

| v1 source | Why out of scope |
|---|---|
| `cloud/auth.ts` | Reads the v1 `Auth.Service` credential store and `KILO_API_KEY`. v2 resolves credentials in-host via the Gateway account Effect; the token never crosses RPC. |
| `cloud/defaults.ts` | Depends on v1 `Agent.Service`, `Config.Service`, `KilocodeModelState`, and `CloudCatalog` to pick mode/model. Model/mode resolution is parent-owned host wiring. |
| `cloud/catalog.ts` | Imports `@kilocode/kilo-gateway` header/url helpers for the model catalog. Catalog routing is parent-owned. |
| `cloud/repository.ts` | `CloudRepository.resolve` uses the v1 `Git.Service` for worktree/remote discovery. Repository discovery is host wiring; the wire `RepositoryInput` contract is carried in `contracts.ts`. |
| `cloud/commands.ts` | Effect CLI orchestration over `process.stdout`/`process.exitCode`. The parent owns the CLI command file (`cloud-command.ts`). |

## Operations: source-backed surface

| Operation | v1 source | v2 surface |
|---|---|---|
| `start` | `agent.start` mutation → `POST /trpc/start` | `CloudRpc.start` → adapter → tRPC. |
| `send` | `agent.send` mutation → `POST /trpc/send` | `CloudRpc.send` → adapter → tRPC. |
| `status` | `getMessageResult` query + `projectStatus` | `CloudRpc.status` → adapter (assistant projected away). |
| `result` | `getMessageResult` query + `resultExitCode` | `CloudRpc.result` → adapter (`{result, exitCode}`). |
| `stream` | `--stream` on `start`: print safe admission, then `streamAgentEvents` in-process using the admission `streamUrl` or a fetched session ticket | `CloudRpc.start` preserves `streamUrl` for the private consumer; `CloudRpc["stream.prepare"]` validates/pins a provided URL or fetches a ticket; the CLI runs `streamAgentEvents` itself. |
| `cancel` | **absent in v1 source** | **Not implemented — source gap.** |

**Cancel is a real source gap, not an omission.** `origin/main`'s cloud module and
`cli/cmd/cloud.ts` expose no cancel/interrupt procedure or CLI verb. No cancel
endpoint was invented here; adding one requires a backend contract that does not
exist in the inspected source.

## Wire contract (exact envelopes)

- `start`/`send`: `POST /trpc/{start,send}`, JSON body = zod-validated
  `AgentStartRequest`/`AgentSendRequest`. Client generates `message.id`
  (`msg_<12hex-ms><14 base62>`) when absent and correlates the response
  `messageId` (and `cloudAgentSessionId` for send) — a mismatch throws
  `ambiguousAdmissionError` ("outcome is unknown; do not retry automatically").
- `getMessageResult`: `GET /trpc/getMessageResult?input=<urlencoded JSON>`.
- Success envelope: `{ result: { data: ... } }`, strict-parsed; `result.data` is
  decoded by the per-method zod schema.
- Stream ticket (when the admission carries no `streamUrl`):
  `POST {webAppOrigin}/api/cloud-agent-next/sessions/stream-ticket` with
  `{cloudAgentSessionId, organizationId?}`; 403/404 retried up to 10×/1s; the
  returned ticket builds `/stream?cloudAgentSessionId=…&ticket=…`.
- WebSocket stream: relative or absolute URL pinned to the agent origin
  (`ws`/`wss` only); newline-delimited events to a sink; completes on
  `{streamEventType:"complete"}` after a 3s grace; idle timeout and an 8 MiB
  queued-output bound.

## Lifecycle / status / error semantics

- Message status: `queued | running | completed | failed | interrupted`.
- `GetMessageResultOutputSchema` enforces lifecycle invariants: `queued` cannot
  carry `acceptedAt`; non-terminal cannot carry `terminalAt`/`completionSource`;
  `failure` only on `failed`/`interrupted`; `gateResult`/`assistant` only on
  `completed`.
- Exit codes (`resultExitCode`): `completed=0`, `queued`/`running=2`,
  `failed=3`, `interrupted=4`.
- HTTP status mapping (tRPC): 401 auth, 402 balance, 403 denied, 404
  session/message not found, 5xx unavailable; redirects are errors.
- RPC error surface is fixed and generic (`kilocode.cloud` /
  `kilocode.cloud_unavailable`); schema and upstream API error text — which can
  embed prompt or repository-token content — is never echoed across the
  boundary.

## Security / credential handling

- The adapter takes an explicit resolved `{token, organizationId?, origins}` and
  never reads a credential store, `process.env`, or a global. Credential/profile/
  selection resolution lives in the host Gateway account Effect (`registerCloud`
  receives it as an argument).
- The RPC `start` input **structurally omits** `options.kilocodeOrganizationId`;
  the resolved selected org is injected host-side. A caller cannot override org
  selection through the wire (verified by `cloud-host.test.ts`). Personal (null)
  selections omit the org field entirely.
- The bearer token is header-only on admission and never crosses the RPC
  boundary; tests assert it never appears in a request body, URL, RPC response,
  or CLI stdout/stderr. The expiring, session-scoped stream ticket in an
  admission's `streamUrl` may cross the authenticated local RPC to its real CLI
  consumer (for the source `--stream` flow); it is never the account token, and
  the parent sanitizes CLI stdout.
- `allowHttpLoopback` is an explicit opt-in flag propagated to the origin guard;
  it is never inferred from ambient environment. Production defaults are the
  source origin constants (`https://cloud-agent-next.kilosessions.ai`,
  `https://kilo.ai`); explicit dev overrides allow only loopback HTTP via the
  existing `parseServiceOrigin` guard.

## Stream over RPC

v1's `cloud start --stream` prints the safe admission (with `streamUrl` elided
from stdout), then opens the WebSocket stream in-process via
`streamAgentEvents`, resolving the stream URL from the admission's
`streamUrl` when present or from a fetched session stream ticket otherwise.

The v2 RPC framework **does** expose a real event channel (`Rpc.define`
`events` plus the `ctx.rpc.register` result's `events.emit`); an earlier draft
of this section claimed otherwise and was wrong. That channel is **not** used
for cloud streaming: routing raw JSONL stream events through a new RPC event
broker would be an invented abstraction with no existing consumer.

The implemented seam is `stream.prepare({cloudAgentSessionId, streamUrl?})` →
`{origin, streamUrl}`:

- A caller-provided `streamUrl` is validated and pinned to the configured agent
  origin (`resolveWebSocketUrl`) **before any ticket fetch**; a cross-origin URL
  is rejected, never followed. The ticket is therefore never forwarded to an
  arbitrary origin.
- When `streamUrl` is absent, `createStreamTicketClient` fetches a scoped ticket
  under the current resolved account and builds `/stream?…&ticket=…`.
- The expiring, session-scoped ticket crosses the authenticated local RPC to its
  real CLI consumer; the account bearer token never does. The parent sanitizes
  CLI stdout.
- The CLI then opens the existing `streamAgentEvents` WebSocket transport itself
  (`cloud start <request.json> --stream`), printing the safe admission as one
  JSON line followed by raw event lines; a transport failure is caught as a
  non-fatal `{streamEventType:"error"}` notice, matching v1.

### Port delta: AbortSignal on `streamAgentEvents`

v1's `streamAgentEvents` has no external cancellation — only the idle,
complete-grace, and close timers. v2 adds an optional `signal?: AbortSignal` to
`StreamAgentEventsOptions` so the CLI can cancel a live stream: a pre-aborted
signal rejects **before any WebSocket is opened**; a live abort closes the
socket, clears every timer and the abort listener, and rejects with
`"WebSocket stream aborted"`. The listener is registered before timers are
armed and before any frame can arrive, with a post-registration aborted re-check
to close the setup race. This is the only intentional behavioural delta from the
v1 transport and is exercised by dedicated unit tests and a real SIGINT CLI
test.

## Verification

Run from `packages/kilo-cli` (tests cannot run from the repo root):

| Check | Command | Result |
|---|---|---|
| Typecheck | `bun run typecheck` | pass (0 errors; `tsgo --noEmit`). |
| Cloud unit tests | `./dist/interactive/bun test test/cloud-transport.test.ts test/cloud-stream-ticket.test.ts test/cloud-websocket-stream.test.ts test/cloud-adapter.test.ts` | in-process contract tests (Bun 1.4.0). |
| Cloud real-launch RPC | `./dist/interactive/bun test test/cloud-cli.test.ts` | 5 pass — spawns the real host via `test/cloud-fixture.ts`, seeds a credential through real device-auth against a loopback gateway, drives `CloudRpc` over authenticated HTTP via the public `createClient`. |
| Cloud CLI subprocess | `./dist/interactive/bun test test/cloud-cli-subprocess.test.ts` | 7 pass — seeds a credential, then runs the packaged `dist/interactive/kilo2` `cloud start/send/status/result` subprocesses against loopback stubs via the dev origin overrides. |
| Cloud streaming CLI | `./dist/interactive/bun test test/cloud-stream-cli.test.ts` | 4 pass — real loopback WebSocket `cloud start --stream`: provided-URL pin, ticket fallback, non-fatal error notice, SIGINT abort. |

Test isolation: every test uses an in-process loopback `Bun.serve` stub or an
injected mock `WebSocket`/`fetch`. **No live cloud endpoint, no cloud task, and
no paid model call is contacted.** Credentials are fixture-seeded through the
real device-auth flow against a loopback gateway; no real account is used. The
bundled Bun 1.4 runtime (`dist/interactive/bun`, and the `dist/interactive/kilo2`
launcher for subprocesses) is used per the package's runtime requirement.

## Deployed verification gaps

These are honest limits of the loopback-stub verification; none are covered by
the tests above and each needs a deployed-environment pass:

1. **Real tRPC envelope drift.** Tests assert the exact `{result:{data}}` envelope
   against a stub that returns it. The live cloud-agent service has not been
   contacted, so envelope drift between the pinned source contract and the
   deployed service is unverified.
2. **Stream-ticket retry cadence against the real web app.** The 403/404 → retry
   behavior is stub-verified; real propagation latency and terminal behavior are
   not.
3. **WebSocket stream against a live session.** Real loopback sockets drive
   event sequencing, provided-URL pinning, ticket fallback, abnormal close, and
   SIGINT abort locally; live reconnect, ordering under real load, and the
   deployed `streamUrl` shape remain unverified against the real service.
4. **Credential/profile resolution end to end.** `cloud-host.test.ts` builds the
   real account Effect from a persisted fixture credential against a stub
   profile backend. A live sign-in and org switch (`/teams`) against the real
   gateway is the parent's integration scope.
5. **Cancel.** Absent from the v1 source contract; there is nothing to verify.
