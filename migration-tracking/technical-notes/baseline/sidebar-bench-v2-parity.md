# Gateway Terminal Bench sidebar v2 parity — 2026-09-07

Root-approved exact delta: tolerantly decode the catalog `terminalBench`
metadata, surface it on the existing Kilo-owned Entry schema, and render the
v1 "Terminal Bench 2.0" sidebar section tied to the viewed session's current
model. No Core/upstream/generated-protocol change, no hardcoded bench data,
absence/invalid means the section is omitted and the model is kept.

## Contract (resolved against the pinned v1 source)

- Producer wire shape: the Gateway models response carries a top-level
  per-model `terminalBench: { overallScore: number, avgAttemptCostUsd: number }`,
  optional and tolerantly decoded (`.optional().catch(undefined)`) at
  `ecccd1f packages/kilo-gateway/src/api/models.ts:48` and passed through at
  `:307`; v1's own tests pin the record shape
  (`packages/kilo-gateway/test/api/models.test.ts:37,76,219`).
- Consumer path: v2 `fetchModelMetadata` → KiloModels `Entry` → the sidebar's
  `KiloModels.list` RPC → the viewed session's current model resolved from
  durable transcript truth (the latest `model-switched` message, falling back
  to the session info's model — `session.model.selected` is not in the
  client-facing live event manifest, so the durable message is the honest
  seam).
- Display units and tones pinned from v1: rows render in the muted text tone
  (v1 `sidebar-usage.tsx:77-79` passes `color={theme().textMuted}` into
  `UsageRow`; the v2 semantic token is `theme.text.subdued` on both the label
  and the value), with Completion = `(overallScore * 100).toFixed(1)%` and
  Cost / attempt = `$avgAttemptCostUsd.toFixed(2)` from
  `packages/opencode/src/kilocode/components/model-info-panel-utils.ts:17-25`;
  section title "Terminal Bench 2.0" (v1 `sidebar-usage.tsx:256-272`),
  collapsible, default open, title in the default text tone.

## What landed

- `packages/kilo-gateway/src/models.ts` — tolerant per-record decode
  (`overallScore`/`avgAttemptCostUsd` must be finite); a malformed or missing
  value omits the metadata and keeps the model (same tolerance as
  `autoRouting`); `CatalogModel` and `fetchModelMetadata` carry it through.
- `packages/schema/src/kilocode/models.ts` — optional `terminalBench` field on
  the existing Kilo-owned `KiloModels.Entry` (no generated-protocol change; the
  RPC is consumed via `client.rpc(KiloModels.Definition)`). Scope note: the
  prompt-selector closed-enum changes in `packages/kilo-gateway/src/models.ts`
  belong to the previously accepted prompt-selector slice (another owner) and
  are not part of this delta; the B1 diff is the `terminalBench` decode,
  `CatalogModel` field, and metadata passthrough only.
- `packages/kilo-cli/src/tui-plugin/sidebar-bench.tsx` (new, Kilo-owned) — the
  section renders only when the viewed session's current model is a Kilo
  catalog model carrying valid metadata; identity
  (`revision`/`organization`/`session`/`location`) drives an abortable
  refetch; `server.connected` refreshes; semantic theme tokens
  (`theme.text.default`/`subdued`); one install line in the production
  `tui.tsx` next to the routed-model sidebar.
- Absence/invalid never drops the model: the decode mirrors the AutoRouting
  tolerance and the inventory keeps the record (tested).

## Regression coverage

- Raw decode through the real RPC (`packages/kilo-gateway/test/plugin.test.ts`):
  valid metadata surfaces on the Entry; absent stays absent; malformed
  (string, non-finite, wrong shape) is dropped per model without dropping the
  model. Tolerance matches the pinned v1 decode exactly: v1's
  `z.object({ overallScore: z.number(), avgAttemptCostUsd: z.number() })` with
  `.optional().catch(undefined)` rejects non-finite numbers (z.number()
  rejects NaN/Infinity) and any wrong shape while keeping the model; the v2
  `Schema.Finite` fields plus per-record decode reproduce that. 24 tests /
  0 failures for the file.
- Real-renderer isolated-host fixtures
  (`test/sidebar-bench-ui-fixture.tsx` + `test/sidebar-bench-ui.test.tsx`,
  bundled Bun 1.4.0, loopback-only Gateway): 4 pass / 0 failures —
  `valid` (exact pinned formatting `42.5%` / `$1.23`, keeping-width resize
  does not disturb the section, narrow/wide auto-sidebar hide/restore),
  `absent` (no section), `invalid` (no section, no invented value, model kept),
  `switch` (model switch hides/returns the section with no stale value; the
  account switch to a scope whose catalog carries no bench data hides the
  section — the personal value never leaks — and switching back restores it,
  driven through the production /profile account refresh that bumps the TUI
  revision).
- Consolidated review fixes (same fixtures): the identity-change handler clears
  the held entries before the refetch — a **source-reviewed defensive
  invalidation**: the public account-switch triggers (the /teams and /profile
  commands) wait for the server-side catalog to warm before the revision bump,
  so no stale window is empirically demonstrable at those triggers and the test
  makes no no-stale-intermediate guarantee; `server.connected` keeps the held
  entries until the refresh lands (reconnect without flicker). An actual color
  assertion reads the render buffer's fg values and asserts the bench rows
  render in the theme's subdued tone (equal to a known subdued element,
  distinct from the section title's default tone), per the pinned v1 muted
  tone; a reviewer mutation of the tone fails the test. The decode tolerance
  test additionally covers a non-finite (NaN) record: dropped per model,
  model kept.

## Honest gaps

- The section is per-session-view (the current model), not a live metrics
  feed: the catalog metadata is static per account scope and refetches only on
  the identity changes above.
- v1 also showed bench data in the model-info panel
  (`model-info-panel.tsx:131`); the v2 model-info equivalent is not part of
  this delta and is not claimed.
- Multi-platform rendering was not probed; the fixture is macOS arm64 with the
  bundled Bun 1.4.0, matching the accepted sidebar fixtures.
