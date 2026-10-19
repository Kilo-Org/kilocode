# CLI/TUI closure verification — row "CLI TUI remainder" — 2026-09-07

## Goal 70 superseding acceptance evidence — 2026-09-07

All newly identified local implementation and automated acceptance gaps are
resolved. The earlier findings below describe the earlier checkpoint.

- Memory has a persisted session/root-bound fact for nonempty context injection,
  plus the existing five-second save pulse. Identity changes reset that pulse.
  Parent: 4 sidebar tests / 11 assertions, 30 memory contracts / 160 assertions.
- Model details use the accepted relocated public dialog, retaining the native
  picker. Description, reasoning, family, cached Free and actual tier quotes
  render from public records. Zero and 128K thresholds, a short viewport and
  unavailable metadata have real renderer coverage: 4 scenarios pass. The
  local-server sync-error toast remains source-reviewed, not fault-injected.
- Funded personal Credits/Pass/Bonus/Renews, privacy and team balances, plus the
  actual routed model and ordinary-response absence: 2 renderer suites pass.
- Usage expansion/collapse now has real mouse interaction and per-model counts;
  indexing runs the real engine through In Progress and Complete. Parent:
  3 tests / 6 wrapper assertions. The usage cleanup hang was fixed by returning
  focus to the composer before typing `/exit`; no usage-production fix was needed.
- Agent/Plan/import parent integration: 68 tests / 354 assertions. Previously
  accepted PR and process lifecycle/restart evidence is retained, not rerun or
  relabeled as new validation.

Root accepts automated real-host equivalents for the implementation inventory.
UI-081/082/083 manual statuses remain NOT RUN. The process restart equivalent
restarts the isolated host against its existing layout and verifies real process
truth; it is not claimed as a manual daemon-restart run. The measured same-commit
branch watcher limitation, shared with the native footer, remains disclosed.
Native throughput is reused; no absent process description/port data is invented.
These are explicit v2 scope/layout decisions, not claims to reproduce every v1
visual arrangement. The canonical plan owns the final count and bundle evidence.


Bounded whole-row closure verification, not a general audit. Provenance: this
checkout at the frozen accepted batch; Kilo v1 source `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; canonical row and scenario text
read from `plans/kilo-opencode-v2-issue-13750.md` and
`plans/kilo-opencode-v2-test-plan-ui.md` (both root-owned, untouched). Bundled
Bun 1.4.0 (`packages/kilo-cli/dist/interactive/bun`) for every run. All other
writers frozen; no production write was made or is proposed without root's
delta approval; manual scenario statuses stay untouched (an automated
equivalent never marks a manual case RUN).

## Row checklist — verified items

Each item below was re-verified in this session against pinned v1 source and
current v2 code, with a green run where listed.

- [x] **Built-in agents (Code/Ask/Debug/Explore + Plan workflow).** Explore
      shell ceiling accepted: 5 tests / 78 assertions real-host
      ([explore-policy-v2-parity.md](explore-policy-v2-parity.md)); Code/Ask/Debug
      and Plan workflow accepted earlier. Orchestrator: **not a required gap** —
      v1 registers it only as `deprecated: true` (`kilocode/agent/index.ts:588-624`
      at the pin), v1's own migration doc calls it "Redundant"
      (`kilocode/docs/migration.md:110`), the canonical row text records the
      decision ("record its compatibility decision separately rather than restoring
      it as an active default"), and
      [agent-policy-v2-parity.md](agent-policy-v2-parity.md) records
      "Intentionally not resurrected" with the real-renderer picker asserting its
      omission (`test/model-picker-ui-fixture.tsx`).
- [x] **PR sidebar (UI-081/082 automatable steps).** Fixture-backed equivalent
      run today on the real renderer, isolated host, fixture `gh` shim only:
      `test/sidebar-pr.test.tsx` (12 tests) and `test/sidebar-pr-ui.test.tsx`
      (8 scenarios, 33.9s) — **20 pass / 0 fail**. Step mapping: tracking/branch
      lookup, local-SHA and fork-parent/fork-SHA chains (`sha`, `parent`,
      `parent-sha`), wrong-head rejection (`sha-wrong`), malformed/null fail-closed
      (unit), no-`gh` (`nogh`), long-title wrap at narrow/wide with
      hide/show-single-relookup and width-only no-duplicate lookup (`found`),
      in-flight supersede with no late render and no retry (`stale`), clean abort
      of a lookup in flight across `/exit` (found + unit kill-grace/escalation
      tests).
- [x] **Running-shell sidebar (UI-083 automatable steps).** Equivalent run
      today: `test/sidebar-processes.test.tsx` (4) and
      `test/sidebar-processes-ui.test.tsx` (2 scenarios, 13.3s) — **6 pass / 0
      fail**. Step mapping: real background shell through the public
      `session.shell` API with command + real PID row; session isolation on tab
      switch; durable re-sync keeps running truth; shell ending while another
      session is focused reconciles on revisit; narrow/wide resize; exit cleanup;
      ended/missing entries never render (unit).
- [x] **Memory row states.** Loading/Unavailable/Disabled/Enabled distinguished
      from the real Memory RPC with consent-model respect and real refresh
      triggers; suite green today (`test/sidebar-memory.test.tsx`,
      `test/sidebar-memory-ui.test.tsx`, 5 tests / 10 assertions across the three
      files including usage).
- [x] **Credits/Pass, indexing, session-family usage, routed-model section,
      native sections preserved.** Accepted ledgers
      ([model-sidebar](model-sidebar-v2-parity.md),
      [sidebar-indexing](sidebar-indexing-v2-parity.md),
      [sidebar-usage](sidebar-usage-v2-parity.md)); usage suite green today;
      `sidebar-routed-model.tsx` renders the v1 routed-model-meta equivalent as
      its own accepted section.

## Row checklist — blocking remainder (each with exact source/consumer)

### B1 — Terminal Bench 2.0 sidebar: accepted 2026-09-07; model-info surface pending

Root accepted the bounded sidebar and metadata delta after independent review
and the final cleanup: Gateway 24 tests / 329 assertions, sidebar UI 4 tests /
8 wrapper assertions, CLI typecheck clean. No whole-row credit is claimed.

The v1 benchmark data is **catalog metadata, not a usage-RPC field** — the
existing reduction record's stated reason ("the durable RPC does not provide
one") is correct for throughput but does not cover bench. Verified:

- v1 producer: the Gateway models response itself carries it —
  `packages/kilo-gateway/src/api/models.ts:48` (zod schema) and `:307`
  (passed through per model record), tested at v1
  `packages/kilo-gateway/test/api/models.test.ts:37,76,219`
  (`{ overallScore, avgAttemptCostUsd }`).
- v1 consumer: `packages/kilocode/plugins/sidebar-usage.tsx:71-75` reads
  `provider?.models[current.modelID]?.terminalBench` and renders the
  "Terminal Bench 2.0" collapsible (Completion score, Cost/attempt) at
  `:256-272`; also `kilocode/components/model-info-panel.tsx:131`.
- Before B1, v2 dropped `terminalBench`. The accepted delta now carries it
  through Gateway metadata and the KiloModels Entry to the sidebar; the
  model-info surface remains absent.

Implemented within the approved bounds; see
[sidebar-bench-v2-parity.md](sidebar-bench-v2-parity.md) for the resolved
contract (producer wire shape + consumer path), the landed files, and the
regression coverage (raw decode + four real-renderer scenarios including
model/account switches and narrow/wide). The v1 model-info panel surface
remains recorded, not implemented.

### B2 — Throughput row: recorded reduction, capability exists natively

v1's throughput is **not** a durable field: it is computed client-side from
live stream samples with a `source === "computed"` gate
(`sidebar-usage.tsx:55,105-112`), shown only when samples exist. V2's durable
usage RPC carries tokens/cost/steps but no rate, the native session footer
already renders live `tok/s` when enabled
(`packages/tui/src/routes/session/index.tsx:2064-2066`, `session.tps`
config), and [sidebar-usage-v2-parity.md](sidebar-usage-v2-parity.md) records
the reduction. Classification: genuinely equivalent capability on a different
surface; whether the recorded reduction satisfies the row's throughput
acceptance was resolved by root: accept the native live throughput surface
instead of adding a duplicate Kilo counter. This disposition does not close
the broader CLI/TUI row.

### B3 — Memory Enabled active tone: save pulse accepted; durable markers pending

V1 semantics at the pin
(`kilocode/cli/cmd/tui/component/memory-status.tsx:13-25`): Enabled renders
success when the viewed session has memory injection markers or within 5s of a
session save pulse. V2 keeps Enabled muted, documented
(`src/tui-plugin/sidebar-memory.tsx:16-20`). Verified seams: v2's injection is
request-scoped ephemeral and admits no durable synthetic message
(`src/memory-plugin.ts:573`); the dormant
`packages/kilo-memory/src/marker-meta.ts` helper has no consumer, so the
marker half genuinely has no v2 producer without engine changes. The
five-second save pulse is now accepted after user confirmation and independent
review: existing engine saved events cross the public Memory RPC and affect
only the attributed session's Enabled bullet. No new persisted `lastSave`
record or polling-based pulse was needed. See
[memory-activity-next-slice.md](memory-activity-next-slice.md) for the 39-test
root verification and explicit coverage limits. The durable-marker half
remains pending; the broad row stays open.

### B4 — Manual scenario statuses stay NOT RUN

`UI-081`/`UI-082`/`UI-083` remain **NOT RUN** in the root-owned
[UI test plan](../plans/kilo-opencode-v2-test-plan-ui.md). The automated
equivalents above ran green today on the real renderer isolated host, which is
**not** a manual-run mark. The genuinely unautomated steps are recorded, not
fabricated: UI-083's "record behavior after restarting the client/server"
(no automated equivalent exists and none is claimed), and UI-082's
same-location Git-branch watcher behavior — the measured producer limitation
on this host, recorded in
[sidebar-pr-v2-parity.md](sidebar-pr-v2-parity.md) and shared with the native
footer, per-host rather than component-owned.

## Discipline

- No production writes: the only artifacts of this verification are this doc
  and the test runs above; no existing file was modified, no new test was
  needed (the existing suites already exercise every automatable scenario
  step; the unautomatable steps are recorded rather than simulated).
- No percentage speculation: the row remains open in the canonical plan.
  B1 sidebar and B2 native throughput are accepted; the model-info surface,
  B3 memory activity and the remaining manual cases stay pending.
- No upstream change, no install, no live account; loopback and fixture-only
  processes; bundled Bun for every run (31 sidebar-related tests green today).
