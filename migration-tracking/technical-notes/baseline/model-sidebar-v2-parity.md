# Model, agent and sidebar batch — 2026-09-05

**Superseded memory completion claim:** the subsequent user smoke test still
found duplicate memory entries and latest-main UI/feature gaps. See the
[memory correction](memory-v2-parity.md#reopened-after-user-smoke-test--2026-09-05).
The prior duplicate test below was too narrow; current inventory is 24/43,
not this batch's historical 25/43 checkpoint.

Source: local v1 `origin/main` at `ecccd1f54b62f9bb16e53a2a58b32bb6d98d0fd7`;
current v2 `59b29de40966803e2c7cd734d439843fb773f6a6` plus local Kilo changes.
This is source-backed and local-workflow-tested, not live-contract-verified.
Tests use isolated profiles, loopback services and no paid inference.

| Surface | Implementation / evidence | Still open |
|---|---|---|
| Gateway priority | Optional `TuiApp.modelPicker` presentation hook; Kilo supplies `preferredProviderID: kilo`. Native picker/actions/storage stay upstream-owned. Native default remains OpenCode without the option. | No automatic model/default change is intended. |
| Recommended | `kilocode.models.list` resolves the authenticated selected account; personal `/api/openrouter/models`, team `/api/organizations/:id/models`; actual `preferredIndex` becomes recommendation order. Only IDs already in native inventory are grouped. | Most Used is not Recents; no usage-history clone or live endpoint verification. |
| Kilo Auto | Available `kilo-auto/*` IDs and actual `autoRouting` metadata produce the Auto group. The current native snapshot already has Auto IDs. Missing metadata falls back without fabricated recommendations. | This is not a dynamic catalog replacement, proof of every eligible model, or routed-model transcript metadata parity. |
| Favorites | Real TUI test toggles a native favorite and reopens the picker to prove retention. No favorites are seeded or v1 store imported. | Cross-version preference migration is not part of this batch. |
| Built-in agents | Production post-plugin names native `build` Code and supplies absent Ask/Debug policies; custom IDs and native hidden/delegated agents survive. Real native permission checks and loopback denied-tool execution. | Native Plan is retained; Kilo custom saved-plan/exit/implementation lifecycle remains open. See [agent policy](agent-policy-v2-parity.md). |
| Duplicate `/memory` | Native autocomplete now matches dispatch precedence: local command names/aliases shadow same-named server commands and skills. Real TUI asserts one row and immediate local handling; public command inventory still includes memory. | No server API removal or separate interactive-only host flag. |
| Memory sidebar | Native `sidebar.content` slot, active session location, loading/unavailable/disabled/enabled, automatic-consolidation status and estimated index tokens. Local command mutations and native execution completion refresh status. No implicit enable or source-text rendering. | No invented busy/activity indicator; arbitrary external store writes have no dedicated event contract. |
| Credits / Pass | Native `sidebar.footer`; validated selected-account balance, personal Pass only, real zero distinct from unavailable. Privacy masks credit amounts and suppresses the entire Pass section. Account/session changes discard stale responses. | Source response schema is fixture-tested, not deployed verification. No purchase/account changes. |
| Native sidebar | Existing context/spend, MCP and location/branch views remain untouched. Existing auto-hide threshold is preserved (>120 available columns). | Indexing, jobs, PR and detailed usage sections remain separate inventory work. |

## Boundaries and refresh

Model metadata uses the existing authenticated Gateway transport and account
selection lock. No account bearer enters presentation metadata. Picker effects
abort old requests when catalog/location changes; failed metadata leaves the
native inventory usable. Sorting never changes provider/model identities.

The bounded shared changes are in native runtime/model-picker presentation,
autocomplete de-duplication, and agent-name rendering in the picker/composer.
Each is marked `kilocode_change`; Kilo policy, transport, metadata and panels
remain in Kilo-owned modules. No Core execution engine or sidebar layout is
forked. Agent selection still uses IDs (including `build`), not display names.

Balance uses `/api/profile/balance`, with the selected organization header only
for a team. Personal Pass uses the source-backed batched
`/api/trpc/kiloPass.getState` envelope. Independent failures return absent data,
not a zero balance. The account view clears stale data on refresh and account
changes, refreshes after the selected session's successful execution, and polls
teams every 60 seconds. Disposing a view cancels its requests/subscriptions.

## Verification targets

Final bundled Bun 1.4.0 checkpoint: `kilo-cli` full `script/test.ts` **373 pass,
0 fail, 2,413 assertions, 64 files** (324.52s); `kilo-gateway` full suite
**38 pass, 0 fail, 284 assertions**. Focused native TUI model ordering,
preferences and autocomplete suites: **23 pass, 0 fail**. Typechecks pass in
Kilo CLI, Gateway, Client, Schema and TUI. Targeted formatting and
`git diff --check` pass. Initial broad-run renderer races were fixed with
test-only frame/input synchronization before the final green rerun.

- `kilo-cli`: `model-picker.test.ts`, `model-picker-ui.test.tsx`,
  `agent-policy.test.ts`, `sidebar-memory-ui.test.tsx`, `memory-ui.test.tsx`,
  `sidebar-account.test.tsx`, `sidebar-account-ui.test.tsx`, and existing
  `gateway-integration.test.ts`.
- `kilo-gateway`: account and plugin tests cover independent failures, zero,
  team scoping and authenticated model metadata.
- `tui`: `test/kilocode/model-presentation.test.tsx` preserves upstream ordering
  without the optional host policy.

Real TUI fixtures prove both sidebar panels at 160 columns and privacy changes
through public RPC. Account visual coverage is specifically personal zero and
privacy suppression; team scoping and independent failures are transport/RPC
tests, not a completed team-switch sidebar visual test. A bounded attempt at
that extra dialog fixture did not produce a team refresh and was not retained;
no production correctness claim is drawn from that inconclusive attempt.
Narrow terminal/scrolling and all remaining source-specific sections are not
claimed complete. This batch's historical coarse checkpoint was **25/43 (58.1%)**;
the subsequent memory correction above supersedes it.
