# Model-info bench seam — v1 surface vs v2, relocated capability — 2026-09-07

Bounded implementation of the missing v1 model-info display surface. Provenance:
this checkout at the frozen accepted batch; pinned v1 source
`ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`; accepted B1 files untouched.

## Detail expansion, pricing fixes, and scrolling — 2026-09-07

The relocated model-info panel now carries and renders full source-backed display metadata:
- **Description & Reasoning**: Gateway source contracts (`v1 api/models.ts`) publish `description`
  and `supported_parameters` (including `"reasoning"`). These are now captured in `packages/kilo-gateway/src/models.ts`
  and carried as display-only optional fields on `KiloModels.Entry` (`packages/schema/src/kilocode/models.ts`).
  They are never written to request settings and render only when present in the catalog.
- **Family**: captured from `opencode.family` when present on the Gateway record and projected to `Entry`.
- **Cached Free rule**: fixed `fmtCachedPrice` per v1 rule (`model-info-panel-utils.ts:28`): cached price
  renders when `cache.read > 0` or when `input === 0` (rendering `Cached: Free`).
- **Tiered context pricing**: displays actual tiered pricing entries using the source threshold
  (`context > tier.size`, matching `packages/core/src/session/usage.ts:25`), showing input, output,
  and cached rates for each tier (including zero-threshold tiers `tier.size === 0`, with no invented
  `> 0` filter). No invented average costs are calculated or displayed.
- **Scrolling**: wrapped panel details in an OpenTUI `<scrollbox>` with dynamic terminal bounds
  (`useTerminalDimensions()`), while keeping the `Browse only; the session model is unchanged.` notice
  anchored at the dialog base. Bounded scrolling verified at short terminal height (20 rows) with footer visible.

Real-host renderer coverage:
- Valid metadata (description, reasoning, family, bench, and free cached pricing).
- Configured native `Model.Info` context-tier quotes (`ordinary`: base `$3.00/1M`, `$15.00/1M`, `$0.30/1M`; `Context > 0:` `$4.00/1M`, `$20.00/1M`, `$0.40/1M`; `Context > 128K:` `$6.00/1M`, `$30.00/1M`, `$0.60/1M`).
- Bounded scrolling at short terminal height (`setup.resize(120, 20)` with footer `"Browse only; the session model is unchanged."` remaining permanently visible).
- Real loopback 503 metadata RPC failure (`scenario === "unavailable"`), asserting the warning `"Kilo model metadata unavailable for this account scope"`, omission of bench section, and zero public session mutation.
- Absent metadata (clean omission of optional rows without fabrication).
- Signed-out empty catalog feedback ("No models available for this location.").
- Direct unit tests in `packages/kilo-gateway/test/models.test.ts` cover tolerant schema decode and projection (2 tests / 20 assertions).

## Public path testability note

- Metadata RPC failure is fully and cleanly driven through real loopback Gateway controls (503 response on `/api/openrouter/models` after initial catalog load).
- Location model sync (`ctx.data.location.model.sync(location)`) communicates with the in-process local OpenCode server and cannot be induced to fail through public loopback endpoints without terminating the local server process itself; its error catch-block toast remains source-reviewed behavior.

## Finding

**No faithful existing UI equivalent exists, and no clean Kilo-owned seam can
mount the exact v1 surface.**

- The exact v1 surface: `ModelInfoPanel`
  (`ecccd1f packages/opencode/src/kilocode/components/model-info-panel.tsx`) —
  a 30-wide, left-bordered scroll panel (name, provider, BYOK/collects-data
  disclosures, Family, Released, Input/Output/Cached/Avg Cost, Context,
  **Terminal Bench 2.0**, Reasoning/Caps/Out, description) mounted beside the
  model picker list on wide terminals (width ≥ 108 → dialog "xlarge") for the
  highlighted item — `packages/tui/src/component/dialog-model.tsx:12` and
  `:172-173` at the pin (Kilo changes).
- The v2 native picker (`packages/tui/src/component/dialog-model.tsx`, shared
  file, host-presentation markers only) has no preview panel, no wide sizing,
  and emits no per-option details. The upstream `DialogSelect` does support
  per-option `details` strings (`packages/tui/src/ui/dialog-select.tsx:71-73,
769-783`), but feeding them from the model dialog is still a shared-file
  edit. The host presentation boundary
  (`TuiModelPicker`/`TuiModelGroup`, `packages/tui/src/context/runtime.tsx:5-26`)
  is group metadata only (category/order/footer/hidden/preferred) — no panel
  surface.
- Therefore the **exact picker preview stays pending**: restoring it faithfully
  requires a shared native patch, which is out of scope without root's explicit
  exception. This is a layout difference, not a retired behavior.

## Implemented: relocated capability (Kilo-owned, public primitives only)

`packages/kilo-cli/src/tui-plugin/model-info-dialog.tsx` (new) — a standalone,
browse-only **"Kilo model info"** command (command palette + `/model-info`
slash) via the public `ctx.keymap.layer` + `ctx.ui.dialog.select` +
`ctx.ui.dialog.show` primitives, the same public surface the memory dialogs
use (`tui-plugin/memory-dialog.tsx:20-26`):

- **Browse-only selection**: `ctx.ui.dialog.select` lists the location's
  enabled models from the reactive data store
  (`ctx.data.location.model.list`, public generated `ModelInfo` records),
  pre-highlighting the viewed session's current model (durable
  `model-switched` truth, shared with the accepted bench sidebar). Choosing an
  entry opens the panel; nothing mutates the session model. The eligibility
  identity snapshots `ctx.location` (a reactive getter,
  `packages/tui/src/plugin/api.tsx:113`) **before the first await** and
  rechecks the live value after the metadata fetch and after the select, and
  the open panel's deferred scope guard includes the live location — a scope,
  account, or location change during the awaits or while the panel is open
  closes it. Fixture note: the browse list is driven with the proven
  `pressArrow` navigation (no filter-input race).
- **Source-backed metadata**: the panel renders name, provider, family
  (optional), Released (`time.released` — the producer is
  `packages/core/src/models-dev.ts:116-119`, epoch milliseconds), Context
  (`limit.context`), and the bounded cost rule — exactly one untiered quote is
  the labeled base quote (Input/Output, Cached when `cache.read > 0`);
  tiered entries are only announced ("Additional context pricing tiers
  available", no guessed inequality); an empty cost array or multiple untiered
  quotes render "Pricing unavailable" / the tiers line without presenting
  first-array-entry prices as universal cost. Formatting units are pinned from
  v1 `model-info-panel-utils.ts:10-48`, reimplemented locally (no source-tree
  imports). V1 stored a single cost object; the array-selection rule above is
  a v2 adaptation, not a v1 behavior. No description/Reasoning rows: the public `ModelInfo` shape has no
  such fields and none are fabricated.
- **Terminal Bench 2.0**: from the accepted `KiloModels.Entry.terminalBench`
  via a **fresh per-open** `KiloModels.list` fetch (no stale catalog reuse; the
  fetch is aborted when the dialog closes), exact units
  (`(score*100).toFixed(1)%`, `$usd.toFixed(2)`), rendered only for
  `providerID === "kilo"` models, omitted when absent or malformed.
- **Unavailable scope**: when the metadata RPC fails, the panel shows an
  explicit "Kilo model metadata unavailable for this account scope" warning and
  no bench section.
- **Scope invalidation**: with root's existing account/revision accessors, a
  scope or account change while the dialog is open closes it rather than
  retaining stale eligibility (no new cache).

**Installed through root-owned `tui.tsx` wiring:**

```ts
import { installModelInfoDialog } from "./model-info-dialog"
installModelInfoDialog(ctx, { client, account, revision, signal: controller.signal })
```

placed next to the accepted `installBenchSidebar` call; `client` is the
existing `kiloHttp` client, `account`/`revision` the existing accessors passed
to `installAccountSidebar`, `signal` the existing controller signal. No
`tui.tsx` edit was made by this slice.

## Remaining boundaries

The exact picker-attached layout remains deferred to retain the native v2 picker
without shared-file edits; the relocated standalone dialog provides the capability
through public primitives. Zero-cost cache pricing now correctly renders "Free" per v1
rules. Tiered pricing renders actual thresholds (`context > tier.size`); no average cost
is invented.

## Wider expected-value update needed outside ownership

In `packages/kilo-gateway/test/plugin.test.ts:665`:
```ts
expect(yield* host.models().list({}, call())).toEqual([
  { id: "fixture", hasUserByokAvailable: true, mayTrainOnYourPrompts: false },
])
```
Because `family` is now carried on `KiloModels.Entry` and the test mock supplies
`opencode: { family: "fixture" }`, the returned entry includes `"family": "fixture"`.
Since `packages/kilo-gateway/test/plugin.test.ts` is outside this slice's ownership, this
expected-value update is reported to parent for integration rather than edited directly.

## Verification

- `packages/kilo-cli/test/model-info-dialog.test.tsx`: **5 pass / 0 fail / 19 assertions**
  under bundled Bun 1.4.0 (13.3s). Covers `fmtCachedPrice` (v1 `cache.read > 0 or input === 0` rule),
  `fmtPrice`, `fmtContext`, and real renderer tests across valid metadata (with Description, Reasoning,
  Family, and Free Cached pricing), absent metadata (verifying clean omission without fabrication),
  and signed-out empty catalog.
- `packages/kilo-gateway/test/models.test.ts`: **2 pass / 0 fail / 20 assertions**. Covers
  tolerant schema decode and projection of `description`, `reasoning`, `family`, and `terminalBench`.
- Typechecks: `packages/schema`, `packages/kilo-gateway`, and `packages/core` pass clean (`tsgo --noEmit`).
  `packages/kilo-cli` typecheck passes clean (`tsgo --noEmit`).
