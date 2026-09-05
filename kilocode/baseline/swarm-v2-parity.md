# Kilo Swarm v2 parity boundary

Kilo Swarm is an explicit, default-off Kilo delta. It ports the v1 shared board
for one root session and its task descendants, not a new agent runtime or an
unrelated-session broadcast channel.

## Implemented seam

- `packages/kilo-cli/src/swarm.ts` registers `board_read` and `board_post` only
  when the host supplies `enabled: true`, an authenticated public session client,
  and an in-process permission authorizer.
- The board uses plugin storage, which is global by plugin ID, so every record
  is keyed by its resolved root session ID. `swarm-store.ts` serializes
  read-modify-write in one process, schema-validates a present record before
  reading or writing it, bounds messages, aggregate storage, and pages, and
  returns an existing post only when a repeated source tool-call identity has
  identical arguments (v1 rejects changed-argument retries).
- Session ancestry is resolved through the public plugin session API. Explicit
  recipients are checked through the supplied public client and must share both
  location and root; `main` and `ALL` are the only symbolic recipients.
- Context guidance labels peer text untrusted and states that posts, HOLD, and
  VETO do not authorize, wake, assign, cancel, or resume work. The v1 guidance
  is adapted to v2's native `subagent` session vocabulary.
- `ctx.tool.hook("execute.after")` adds fixed activity text/metadata to real
  completed tool results, never a peer message body. A host-only guard uses
  native configured permissions, saved grants and plugin evaluation without
  asking for permission. A successful complete read advances only to the
  returned read cursor; notifications are deduplicated per session. Interrupts
  propagate. No notice or stored post claims delivery, reading, or liveness.

## Proven v1 source

`ecccd1f:packages/opencode/src/kilocode/board/store.ts`, `tool/board.ts`, and
`board/context.ts` define the persistent root-descendant board, explicit reads,
idempotent posts, paging, and untrusted-peer boundary. The v1 configuration
flag is `experimental.shared_agent_board` in
`packages/core/src/v1/config/config.ts`.

## Verification

Bundled Bun 1.4: `test/swarm-host.test.ts` and `test/swarm-store.test.ts`
plus `test/board-notice.test.ts` pass **7 tests / 47 assertions**. The host test creates actual descendants by
executing the native `subagent` tool against a loopback model, rather than
misusing `session.fork`: v2 conversation forks have no `parentID` and remain
separate board roots. It checks default-off inventory, rejected writes,
feedback, saved approval, completed tool content, admission retry without a
duplicate post, participant identities, deduplicated notices, cross-root and
moved-location refusal, explicit denial, and persisted history after a real
host process restart. Store tests exercise paging, idempotency conflicts,
foreign cursors/replies, bounds and corruption refusal. Expected validation
failures use typed errors; a real invalid-cursor tool call settles as an error
instead of escaping the tool contract as a defect.
The notice-guard host tests verify allow, non-interactive ask, saved approval,
configured deny taking precedence over saved approval, and evaluator hooks.

The empty-board test found a real adapter bug: an undefined cursor in tool
metadata failed durable JSON projection and left running tool records. Empty
cursors are now omitted; assertions inspect completed output, not tool inputs.
The earlier negative-only fork fixture was replaced by this host coverage.

## Host boundary and deliberate deltas

The host wires explicit `--swarm` opt-in for interactive/run/serve/ACP and composes the real Core
permission service into the in-process authorizer. Its exclusive interactive
profile lease is the single-writer boundary for global plugin storage; the
store's semaphore only serializes read-modify-write operations within that
host process. No board state is exposed as RPC and no provider or model request
is made by the board. Daemon/attach flag combinations that cannot reconfigure
their existing host are refused. V1 SQLite rows are not migrated: v2 uses its
existing plugin KV store and opaque cursors. Native v2 session placement, not
fork provenance or guessed participant ownership, defines the board boundary.
