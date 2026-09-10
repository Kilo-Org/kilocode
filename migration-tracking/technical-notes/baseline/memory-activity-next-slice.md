# Memory sidebar save pulse v2 slice

Follow-up to [memory-sidebar-v2-parity.md](memory-sidebar-v2-parity.md). Source
reference: pinned v1 `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`,
specifically the save pulse in
`packages/opencode/src/kilocode/cli/cmd/tui/component/memory-status.tsx`: when a
`memory.status` or `memory.updated` event arrives with a matching `sessionID`
and `detail.type === "saved"`, the Enabled bullet turns success for 5 seconds.

## Delivered

Accepted by root after user scope confirmation and independent source review
on 2026-09-07. Root verification: events 5 tests / 9 assertions; CLI memory
and sidebar suites 34 tests / 171 assertions; both packages typecheck clean.
After the format-only cleanup, the pulse-focused subset passed again
(5 tests / 18 assertions), and all eight changed TS files are formatter-clean.
This is bounded save-pulse acceptance, not whole-row completion.

| Behavior | Implementation |
|---|---|
| Per-session saved evidence exists and is published | The engine already publishes `MemoryEvents` payloads carrying `detail.type: "saved"` and a real `sessionID` from the actual producers: the turn-close typed consolidation (`packages/kilo-memory/src/effect/capture.ts`) and the explicit effect saves (`packages/kilo-memory/src/effect/index.ts`). No engine capture/save semantics changed. |
| Hosts observe events without overwriting each other | New additive `MemoryEvents.subscribe(listener)` returns a disposer (`packages/kilo-memory/src/effect/events.ts`). The legacy single `setSink` is preserved; sink and listener failures are contained independently so a failing observer never breaks a persisted memory op or another observer. |
| Scoped forwarding with attribution checks | The v2 memory plugin subscribes in its own scope (disposed at scope close) and emits the new public `saved` RPC event only when the payload has `detail.type === "saved"`, a present `sessionID`, a `directory` equal to this host's memory root, and the named session's actual Location matching the host Location (`packages/kilo-cli/src/memory-plugin.ts`). Same root across locations or hosts cannot misattribute; unscoped saves pulse nothing. |
| Minimal public payload | `MemoryRpc.Definition.events.saved` carries only `{ sessionID }` (`packages/kilo-cli/src/memory-rpc.ts`): no content, counts, or paths. |
| v1 5s success pulse | The sidebar subscribes via `rpc.events.on("saved")`, pulses the Enabled bullet success for 5s on a session match (latest save resets the window), and returns to muted on expiry (`packages/kilo-cli/src/tui-plugin/sidebar-memory.tsx`). |

Explicit public RPC `remember`/`correct`/`forget` saves have no session scope
and intentionally pulse nothing; attributing them to whichever session happens
to be focused would be invented attribution. Their state remains visible
through the status RPC and the memory dialog.

## Honest pending item

Coverage limits: foreign-root rejection is tested; the same-root,
foreign-Location rejection is source-reviewed, not separately exercised.
Pulse expiry is exercised with the real renderer and real timer; resetting
the window on successive saves is source-reviewed. The frame-driven expiry
wait depends on the current renderer cadence. No live-account or
cross-platform acceptance is claimed.

The durable-marker half of the v1 active tone remains open: current main also
turns Enabled success when the viewed session has memory markers in its durable
message parts (memory injected into that session's history). V2 injects memory
into ephemeral request system parts, so no durable per-session marker exists to
read. Recording durable per-session injection evidence (and exposing it
per-session) is an engine/host-owner decision, deliberately not approximated by
the latest-project `lastInjectedSessionID` statistic.

## Verification

All with the bundled runtime (Bun 1.4.0):

- `packages/kilo-memory`: `bun test test/events.test.ts` — 5 pass. Delivery
  until disposal, additivity with the legacy sink, per-listener failure
  containment (sync and async), disposal of one listener preserving others.
- `packages/kilo-cli`: `./dist/interactive/bun run script/test.ts
  test/sidebar-memory.test.tsx` — 3 pass, including the pulse tone mapping.
- `packages/kilo-cli`: `./dist/interactive/bun run script/test.ts
  test/memory.test.ts -t "publishes the saved RPC event"` — 1 pass against a
  real launched host with a loopback model. Covers: unscoped explicit RPC save
  emits nothing; producer saves without a session or for a foreign root emit
  nothing; a real turn-close typed consolidation emits `saved` for its own
  session; a second session's real save emits with its own session ID; a turn
  inside the 300s consolidation interval adds nothing; listener disposal stops
  delivery.
- `packages/kilo-cli`: `./dist/interactive/bun run script/test.ts
  test/sidebar-memory-ui.test.tsx` — 1 pass (stable across two consecutive
  runs). Real production host and TUI with the loopback model: compact bullet
  row at 160 and 140 columns, detail lines absent, muted bullet vs default
  label, the real capture saved event pulses the bullet success and the 5s
  expiry restores muted, a real save attributed to another session never
  pulses, native auto-sidebar hides the row at 100 columns and restores at 140,
  the saved operation persists in the memory index, and the only session work
  is the one prompted turn (one user + one assistant message, empty inbox).
- `bun run typecheck` clean in `packages/kilo-cli` and `packages/kilo-memory`.
