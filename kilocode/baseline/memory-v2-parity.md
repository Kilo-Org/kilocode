# Memory v2 parity boundary

This record compares the bounded v2 port to `origin/main` at
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`. It distinguishes shipped v1
behavior from the intentionally smaller v2 port; it is not a proposal to
recreate the v1 memory engine.

## Reopened after user smoke test — 2026-09-05

The previous completed inventory status was too broad. Remote main was verified
read-only to still be `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`. Its existing
`dialog-memory.tsx` and `memory-palette.tsx` provide a selectable help menu,
structured status/source/stored-item views, autosave activity, refresh and
scrolling. Current v2 `tui-plugin/memory.tsx` instead uses generic alert dialogs.
This is an intentionally reduced reimplementation, not an old modal copied
verbatim, and does not establish the requested latest-main parity.

The duplicate-command regression was insufficient: it counts only occurrences
of the local description. The native palette separately repeats suggested
commands under Suggested and their normal category; Kilo Memory currently
sets `suggested: true`. Inline autocomplete and the palette need distinct
positive/negative checks, including actual row counts. The user's exact inline
case has not yet been reproduced and must not be blamed on an old process.

Engine/capture limitations below remain real missing capabilities, not merely
visual omissions. The plan now marks Memory in-progress. Existing passing
tests validate the bounded adapter only. This correction changes documentation,
not production code.

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
- The injection is read-only and non-durable: it never emits a synthetic
  message, rebuilds an index, repairs malformed state, captures a transcript,
  or runs a second model call. It is marked as reference data rather than
  instructions.
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
  A scoped subscription observes `session.execution.succeeded`, verifies the
  session's Location before reading the project state, snapshots the latest
  complete user/assistant text pair, rejects secret-like source/output text,
  and saves at most one `auto_<assistant-message-id>` note. The stable key and
  serialized subscription make repeated completion observations idempotent.
- The v2 completion boundary is an execution drain, not v1's individual
  turn-close lifecycle: `packages/core/src/session/execution.ts` publishes one
  `session.execution.succeeded` after a coalesced drain. Consequently one v2
  capture snapshots the latest completed pair per succeeded execution. If a
  drain contains multiple promoted prompts, earlier pairs are not separately
  consolidated. Exact v1 per-turn parity would require a new public event that
  exposes turn boundaries; no private runner hook or replacement engine was
  added here.
- V2 records no injected-at/bytes/tokens/session statistics because its state
  has no equivalent durable fields. It makes no claim of those v1 metrics.
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
  mutation. The transform test also proves a missing authorizer fails closed.
- `packages/kilo-cli/test/memory-ui.test.tsx` covers the production TUI command
  through an isolated host and asserts it performs no session or model work.
