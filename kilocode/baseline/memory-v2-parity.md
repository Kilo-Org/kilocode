# Memory v2 parity boundary

This record compares the bounded v2 port to `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`. It distinguishes shipped v1
behavior from the intentionally smaller v2 port; it is not a proposal to
recreate the v1 memory engine.

## Historical reopening after user smoke test — 2026-09-05

The previous completed inventory status was too broad. Remote main was verified
read-only to still be `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`. Its existing
`dialog-memory.tsx` and `memory-palette.tsx` provide a selectable help menu,
structured status/source/stored-item views, autosave activity, refresh and
scrolling. At reopening, v2 `tui-plugin/memory.tsx` instead used generic alerts.
That was a reduced reimplementation, not an old modal copied verbatim, and did
not establish the requested latest-main parity. The replacement and current
evidence are recorded below and in `memory-ui-v2-parity.md`.

The duplicate-command regression was insufficient: it counts only occurrences
of the local description. The native palette separately repeats suggested
commands under Suggested and their normal category; Kilo Memory then set
`suggested: true`. Inline autocomplete and the palette required distinct
positive/negative checks, including actual row counts. Both are now covered;
the issue was not dismissed as an old process.

The engine/capture findings also reopened the coarse row. The subsequent
engine replacement and lifecycle tests below supersede the old compact
adapter; row credit still follows the integrated acceptance review.

## Reusable engine port — 2026-09-05

The source-backed engine now lives in the Kilo-owned
`packages/kilo-memory/src` tree, copied from local `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`. Its storage, markdown,
index/recall, digest, typed-consolidation, session-lock, and port abstractions
remain standalone (Effect and Zod only); the unused v1 HTTP adapter is not
ported.

Two deliberate v2 safety deltas apply. Fresh state defaults
`autoConsolidate` to false, and malformed state reads fail closed without the
v1 package's backup/delete/rewrite recovery. Existing preview roots retain the
same `kilo-memory` v1 manifest and source markdown names. The old compact
state expands in memory; only an intentional mutation may persist the added
engine statistics.

The v2 host adapts only public plugin APIs: execution started/succeeded/failed/
interrupted events, `session.context`, `session.get`, the selected session
model, and `generate.text`. It uses the reusable per-session lock and capture
pipeline. V2 exposes an execution-drain rather than a per-promoted-turn event.
At an observed Started event, only while the root is already enabled with auto
mode on, the adapter snapshots completed assistant IDs. Its terminal capture
then accepts every complete group not in that baseline; the persisted marker
only deduplicates a matching eligible group, never authorizes replay from a
period when auto mode was off. Missing Started evidence (including activation
or enablement mid-execution) skips the terminal capture. Enable/disable/auto/
purge clear that scope-local baseline. Failed and interrupted drains use the
engine's bounded no-model fallback digest path.

The host now provides the optional `readSnapshotDiff` reader. Only after
Started-baseline filtering does it use a capture group's first filtered
assistant `snapshot.start` and last filtered assistant `snapshot.end`, in the
session's owning Location scope. Missing bounds or a failed read omit `diffs`,
which the engine represents as unavailable rather than no edits; a successful
empty diff remains an honest empty list. Recall provenance is available from
the completed public `kilo_memory_recall` tool result and its positive
`metadata.count`, so short recall echoes are suppressed without a heuristic.
The public generation result has text but not provider usage, so v2 does not
infer provider cost. This loses no shipped v1 gate: the reusable consolidation
path records cost as zero, and the v1 lifecycle caller never supplies the lower
port's optional `memoryModel` argument. Neither host exposes a dedicated memory
model setting merely because that lower-level argument exists.

## Shipped v1 behavior

- Project scope only is real shipped behavior. `origin/main:packages/kilo-memory/src/commands.ts`
  rejects `personal`, `use-personal`, `personal-context`, and
  `personal-in-project`.
- The explicit command surface is real: enable, disable, status, show,
  remember, correct, forget, inspect, rebuild, and confirmed purge are parsed
  in `origin/main:packages/kilo-memory/src/commands.ts` and routed by
  `origin/main:packages/opencode/src/kilocode/cli/cmd/tui/memory-command.ts`.
- Automatic mode is also real shipped v1 behavior, not a parser placeholder.
  The same command parser accepts `auto on|off`; the TUI routes it to
  `memory.configure({ autoConsolidate })`; and
  `origin/main:packages/kilo-memory/src/memory.ts` persists that setting.
- Automatic mode is an auxiliary model-backed capture engine. The v1 lifecycle
  subscription in `origin/main:packages/opencode/src/kilocode/memory/turn.ts`
  runs on turn close, and `origin/main:packages/kilo-memory/src/effect/capture.ts`
  resolves and calls a model for digest and typed consolidation. The plan in
  `origin/main:packages/kilo-memory/src/capture/plan.ts` gates both calls on
  `autoConsolidate`.
- V1 startup injection is not a passive read. Its prompt assembly calls
  `KiloMemory.context` from
  `origin/main:packages/opencode/src/kilocode/session/prompt.ts`, and
  `origin/main:packages/kilo-memory/src/memory.ts` records injection metadata.
  The real v1 state schema includes `lastInjectedAt`, bytes, tokens, and
  session ID in `origin/main:packages/kilo-memory/src/schema.ts`.

## V2 acceptance boundary

- Project isolation, default-off state, explicit local operations, typed RPC,
  save/recall tools, and the TUI dialog command are implemented in
  `packages/kilo-cli/src/memory-plugin.ts`, `memory-rpc.ts`,
  `memory-command.ts`, and `tui-plugin/memory.tsx`.
- Enabled v2 memory injects the existing bounded index through the public
  Location-scoped `session.context` hook. The hook is registered in
  `packages/kilo-cli/src/memory-plugin.ts`; upstream v2's public hook is
  applied immediately before request dispatch by
  `packages/core/src/session/model-request.ts`.
- Injection never emits a synthetic message or runs a second model call. A
  disabled root creates no files or calls; an enabled nonempty reference block
  records real injection statistics through the reusable engine. Ordinary
  malformed-state reads fail closed without backup/delete/rewrite. It is marked
  as reference data rather than instructions.
- V2 exposes the real `auto on|off` control through the same command, RPC, and
  TUI paths, persisted as `autoConsolidate` with a default of `false` in
  `packages/kilo-cli/src/memory-plugin.ts`. Auxiliary capture is eligible only
  when both `enabled` and `autoConsolidate` are true; turning on auto while
  memory is disabled performs no model work.
- Model-facing memory tools use the host-provided `ToolAuthorizer` before any
  store mutation or recall. Save maps the v1 approval to
  `kilo_memory_save`, `resources: [action]`, and `save: []`; the query-only v2
  recall maps its fixed `search` mode to `kilo_memory_recall` with
  `save: ["*"]`. Direct RPC and `MemoryStore` calls remain independent, while
  a plugin instance without a host authorizer fails closed at tool execution.
- `packages/kilo-cli/src/memory-capture.ts` uses only public v2 plugin APIs:
  `ctx.event.subscribe`, `ctx.session.get/context`, and `ctx.generate.text`.
  One `MemoryService` lives for the plugin scope, preserving engine session
  locks across closes. Started execution cancels a pending idle flush; scope
  teardown clears owned timers and signals. Real public child `parentID` is
  passed to the engine, which excludes child sessions.
- The v2 completion boundary is an execution drain, not v1's individual
  turn-close lifecycle. The adapter groups all settled assistant steps with the
  consecutive promoted user messages they answer, rather than dropping every
  user but the last in a steering batch. Its Started-time baseline admits only
  later groups, including when there is no persisted marker. Before the engine
  receives a view, `recent` is rebuilt exclusively from those eligible groups,
  so pre-consent/context-compacted text cannot leak through its auxiliary
  context. The source engine's interval behavior remains unchanged: a later
  eligible close schedules the final eligible bounded `recent` view for idle
  flush, instead of forcing extra model calls. Failed/interrupted terminal
  events write only the reusable engine's bounded fallback digest and make no
  auxiliary model call.
- The optional host snapshot reader resolves only an eligible capture group's
  first filtered-assistant start and last filtered-assistant end in that
  session's Location scope. Missing bounds or reader failures omit the diff
  field, which remains unavailable rather than a fabricated empty diff. A
  successful no-change result is the only path that supplies `[]`. Completed
  public `kilo_memory_recall` results provide exact positive-count recall
  provenance. `ctx.generate.text` is an Effect; the adapter runs it with the
  engine abort signal through `Effect.runPromise(..., { signal })`. That
  standard interruption reaches the public host generation/HTTP path: the
  held-model fixture observes its request abort when memory is disabled. Its
  public result carries text only, so no provider usage/cost value is used as a
  capture gate or displayed as inferred cost.
- No personal/global scope, cloud sync, or retention contract is inferred.
  Personal scope is explicitly unsupported by both implementations.

## Evidence

- `packages/kilo-cli/test/memory.test.ts` covers explicit persistence, strict
  per-project routing, disabled no-write context preparation, malformed-state
  non-repair, context-hook registration, enabled/disabled provider-request
  injection (including compaction), restart persistence, non-durable history,
  and a real host with a local fake model proving that no auxiliary call occurs
  until both memory and auto mode are explicitly enabled, that `auto off` stops
  later calls, and that ask/reject/allow/deny decisions happen before memory
  mutation. Its held-primary steer-batch fixture proves all three opted-in
  promoted inputs reach auxiliary capture while pre-opt-in text does not. It
  also proves Started-time multi-group selection excludes prior groups, exact
  completed recall provenance, execution-error and
  held-execution-interrupted fallback-digest persistence with no auxiliary
  call, and held auxiliary-request cancellation. The transform test also
  proves a missing authorizer fails closed.
- `packages/kilo-cli/test/memory-ui.test.tsx` covers the production TUI command
  through an isolated host and asserts it performs no session or model work.
- `packages/kilo-cli/test/memory-diff.test.ts` creates real Git snapshots in a
  session Location scope, proves the normalized structured diff, and proves an
  invalid snapshot is unavailable. The normal fake-model host fixture uses a
  committed Git project and canonicalizes its Location directory with
  `realpath` before activation and session creation. It proves the auxiliary
  prompt receives `added memory-diff-proof.txt +1 -0`. The earlier missing
  bounds were a macOS fixture-only `/var` versus `/private/var` alias: the
  Session Location used the former while the Project/Snapshot worktree used the
  latter, so snapshot scope's raw relative-path check reported the Location
  outside the project. This is a Location-path canonicalization limitation,
  not general normal-host snapshot absence.
