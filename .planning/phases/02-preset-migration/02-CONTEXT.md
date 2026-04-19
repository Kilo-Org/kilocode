# Phase 2 Context — Preset Migration & Clean-Break Schema Cleanup

## Phase Goal

Flip the canonical team switch across the CLI: ship `team/migration.ts` with a file-based migration API, convert the 5 legacy hardcoded presets into bundled JSON quickstart templates (enabled canonical configs with full 7-stage coverage), delete the legacy `TeamRole`/`TeamConfig`/`presets.ts` code paths, switch every CLI consumer to canonical types, flip `GET /config/team/presets` + `POST /config/team/validate` to canonical DTO, rework `/team init` to load quickstarts via `Config.update`, and publish a migration doc.

**SDK regeneration is intentionally deferred to Phase 9.** `./script/generate.ts` is NOT run in Phase 2. The server returns canonical-shape JSON; `@devilcode/sdk` types still reference the legacy shape. This keeps `bun turbo typecheck` clean across the monorepo (devil-vscode consumes SDK types; no breakage at build time). Devil-vscode webview displays broken preset lists at runtime until Phase 9 regenerates the SDK and rewrites the consumer code.

## Requirements (from ROADMAP Phase 2)

- PH2-R1 — `packages/opencode/src/devilcode/team/migration.ts` maps every old role name to a canonical position via a public `migrateLegacyTeamConfigFile(path)` + in-memory `fromLegacyTeamConfig` helper relocated from `config.ts` (MOVE, not copy)
- PH2-R2 — Five legacy presets converted to bundled JSON quickstart templates under `packages/opencode/src/devilcode/team/quickstarts/`; each is an `enabled: true` `CanonicalTeamConfig` that passes strict stage coverage
- PH2-R3 — Migration tests cover all 5 presets + at least 5 synthetic `TeamConfig` fixtures
- PH2-R4 — `/team init` reworked to load quickstarts via `Config.update({team: quickstart.team})` (persistent) instead of the legacy state.ts initialization path
- PH2-R5 — Legacy code paths removed: `presets.ts` deleted; legacy halves of `config.ts` (`TeamRole`, `TeamConfig`, `TeamRouting`) deleted; `fromLegacyTeamConfig` exists only in `migration.ts`
- PH2-R6 — CI passes without backwards-compat shims: `bun turbo typecheck` (monorepo, INCLUDING devil-vscode), team test suite, `bun run knip` (devil-vscode), `bun run format:check`, `bun run check-kilocode-change`, source-links. **SDK is NOT regenerated in this phase** — the `packages/sdk/js/src/v2/gen/` tree remains byte-identical to its pre-Phase-2 state, so devil-vscode compiles against stale-but-present SDK types.

## Success Criteria

- `team/migration.ts` exports `fromLegacyTeamConfig` (moved, not copied), `migrateLegacyTeamConfig`, `migrateLegacyTeamConfigFile`, `LegacyMigrationIssue`, `LegacyMigrationResult`. Also exports `LegacyParseTeamConfig` **solely for test-fixture construction** (named + JSDoc-flagged as test-only; not re-exported from `team/index.ts`).
- 5 bundled JSON quickstart files present and loadable via `loadQuickstartTemplates(): Record<QuickstartId, QuickstartTemplate>`. **JSON bundling uses static imports (`import solo from "./solo-enhanced.json" with { type: "json" }`) — NOT `readFileSync`** — so `bun build --compile` embeds the files statically.
- Each bundled quickstart parses successfully against `CanonicalTeamConfig.safeParse(...)` with `enabled: true` (full 7-stage coverage verified at runtime) AND the compiled single-binary boot actually invokes `loadQuickstartTemplates()` (verification probe calls the loader, not `--version`)
- `server/routes/config.ts` `GET /config/team/presets` returns `QuickstartTemplate[]` — wrapper shape `{id, name, description, icon, team: CanonicalTeamConfig, _meta}`. `POST /config/team/validate` accepts + validates canonical payloads.
- All 11 CLI consumers of `TeamConfig`/`TeamRole` switched to `CanonicalTeamConfig`/`CanonicalTeamRole` — full list below
- `Config.Info.team` field at `config/config.ts:1499` switched from `TeamConfig.optional()` → `CanonicalTeamConfig.optional()`. Existing user `kilo.json` config files with legacy `team` shape will fail parse — migration doc surfaces this explicitly.
- `command-input.tsx:48` reads `Config.get().team` and parses canonical (not legacy). Rewrite the `TeamConfig.safeParse(...)` call.
- `/team init <quickstart>` calls `Config.update({team: quickstart.team})` and opens the workflow dashboard. `WorkflowStateManager` is UNCHANGED (no new param, no schema change — team config lives in `Config`, not workflow state).
- Legacy `TeamRole`, legacy `TeamConfig`, `TeamRouting`, full `presets.ts`, `fromLegacyTeamConfig` block in `config.ts` all deleted. `ReactionRule` + `EffortLevel` retained (canonical config references them).
- Phase 1 test file `canonical-config.test.ts` loses its entire `fromLegacyTeamConfig migration helper` describe block (lines ~264-712) + the 2 legacy-regression tests (lines ~719-738) — 10 migration tests + 2 legacy tests = 12 tests removed. Equivalent migration coverage is relocated to `migration.test.ts` in Plan 02-01 with additional synthetic fixtures.
- Monorepo `bun turbo typecheck` clean INCLUDING `packages/devil-vscode/` (which still imports from stale `@devilcode/sdk` types — compiles without complaint because SDK types did not change)
- Knip, format:check, check-kilocode-change, source-links all exit 0
- Migration guide written at `packages/devil-docs/pages/collaborate/teams/migration-v1.md` — documents Node-API migration path (NO `kilo team migrate` CLI subcommand is shipped in this phase; doc is explicit about this)
- Phase 1 pre-existing test failures (`test/kilo-sessions/remote-ws.test.ts`, `test/kilo-sessions/remote-sender.test.ts`) remain unchanged — not Phase 2 scope

## Existing Assets (from Phase 1 + CODEBASE.md + critique audit)

### Files to read before editing
- `packages/opencode/src/devilcode/team/config.ts` — legacy + canonical types side-by-side (+288 LOC canonical block appended by Plan 01-02)
- `packages/opencode/src/devilcode/team/library.ts` — 11-position canonical library (Phase 1)
- `packages/opencode/src/devilcode/team/capabilities.ts` — canonical capability enum + `STAGE_CAPABILITY_REQUIREMENTS` (Phase 1)
- `packages/opencode/src/devilcode/team/presets.ts` — 5 legacy presets (migration source, deletion target)
- `packages/opencode/src/devilcode/team/agents.ts` — `createWorkflowAgents` runtime glue (consumer)
- `packages/opencode/src/devilcode/team/router.ts` — routing logic (consumer)
- `packages/opencode/src/devilcode/team/index.ts` — barrel exports
- `packages/opencode/src/server/routes/config.ts` — `GET /config/team/presets` + `POST /config/team/validate` endpoints (flip targets)
- `packages/opencode/src/config/config.ts:27, 1499` — top-level `Config.Info.team` field (consumer)
- `packages/opencode/src/devilcode/workflow/build-runner.ts`, `escalation.ts`, `reviewer.ts` — workflow runtime (consumers)
- `packages/opencode/src/devilcode/workflow-tui/context.tsx`, `orchestrator.ts`, `command-input.tsx:48` — TUI runtime (consumers; `command-input.tsx:48` does `TeamConfig.safeParse`)
- `packages/opencode/src/devilcode/workflow-commands.tsx` — `/team init` command (rework target)
- `packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx:17`, `status-bar.tsx:24` — onboarding copy sites (string-only updates; NO layout edits in Phase 2 — layout bug is Phase 5's)
- `packages/opencode/test/kilocode/team/canonical-config.test.ts` — migration tests to relocate (lines 264-712), legacy regression tests to remove (lines 719-738)
- `packages/opencode/test/kilocode/team/router.test.ts`, `config.test.ts`, `workflow-integration.test.ts` — may import `TEAM_PRESETS`; audit during Plan 02-01 pre-flight
- `packages/opencode/script/build.ts:179-210` — single-binary build flow (confirms static JSON import compatibility)
- `.planning/phases/01-foundation/01-02-SUMMARY.md` — Phase 1 handoff notes

### Consumer sweep (11 CLI files + server + top-level config)

| File | Legacy symbol used | Required action |
|---|---|---|
| `server/routes/config.ts` | `TeamConfig`, `TEAM_PRESETS`, `TeamPreset` | `GET /config/team/presets` → return `QuickstartTemplate[]`; `POST /config/team/validate` → parse canonical |
| `config/config.ts:1499` | `TeamConfig.optional()` | Switch to `CanonicalTeamConfig.optional()` on `Config.Info.team` field |
| `devilcode/team/router.ts` | `TeamConfig`, `TeamRole` | Switch to canonical types; capability string matches → canonical enum |
| `devilcode/team/agents.ts` | `TeamConfig`, `TeamRole` | Switch to canonical types; verify tier 1/subagent mapping unchanged |
| `devilcode/team/index.ts` | barrel exports | Remove legacy exports; add migration + quickstart exports |
| `devilcode/team/capabilities.ts` | references to legacy (if any) | Already canonical in Phase 1 (verify) |
| `devilcode/workflow/build-runner.ts` | `TeamConfig` | Switch to canonical |
| `devilcode/workflow/escalation.ts` | `TeamConfig`; `findParentRole` uses `.tier` | Switch to canonical; parent-role tiebreak test added |
| `devilcode/workflow/reviewer.ts` | `TeamConfig` | Switch to canonical |
| `devilcode/workflow-tui/context.tsx` | `TeamConfig` | Switch to canonical |
| `devilcode/workflow-tui/orchestrator.ts` | `TeamConfig` | Switch to canonical |
| `devilcode/workflow-tui/command-input.tsx:48` | `TeamConfig.safeParse` | Switch to `CanonicalTeamConfig.safeParse` |
| `devilcode/workflow-commands.tsx` | no `TeamConfig` | Add quickstart picker; call `Config.update({team: quickstart.team})` |
| `devilcode/workflow-tui/detail-panel.tsx:17` | hardcoded onboarding copy | Update string literal only (line 17); NO layout edit |
| `devilcode/workflow-tui/status-bar.tsx:24` | hardcoded onboarding copy | Update string literal only |
| `test/kilocode/team/canonical-config.test.ts` | imports + iterates `TEAM_PRESETS` (9 references) | Remove migration test block (relocates to migration.test.ts); remove 2 legacy regression tests |
| `test/kilocode/team/router.test.ts`, `config.test.ts`, `workflow-integration.test.ts` | audit for `TEAM_PRESETS` imports | Plan 02-01 Task 1 pre-flight enumerates; fixtures converted to canonical quickstart consumption |

### Conventions (from CODEBASE.md)
- Namespace modules, not classes; Zod schemas exported with `z.infer` types
- Co-located test files in `packages/opencode/test/kilocode/team/`
- JSON bundled resources: static import pattern `import x from "./file.json" with { type: "json" }` at module top-level. Bun `--compile` embeds these statically into the binary. `tsgo` typecheck supports `with { type: "json" }` in TypeScript 5.3+ (repo is on 5.6+).
- Prettier: 120 char width, no semicolons
- `team/` is under `src/devilcode/` — **no `devilcode_change` markers needed**
- Bun native test runner; `cd packages/opencode && bun test <path>` targeted tests
- Type check: `bun turbo typecheck` (tsgo, not tsc)

### Risk Areas Overlap (from CODEBASE.md + Phase 1 handoff + critique audit)
- `server/routes/config.ts` boundary with devil-vscode webview: **runtime break for extension users on main branch** until Phase 9. Documented, accepted per v1 constraint. Because SDK is NOT regenerated in this phase, `bun turbo typecheck` stays clean.
- **Canonical tier overrides legacy tier during migration.** `fromLegacyTeamConfig` sets `tier = POSITION_LIBRARY[inferredPositionId].tier`, ignoring the legacy role's declared `tier`. This means legacy `code-review-pair`'s `coder.tier=1` migrates to `developer.tier=2`. Hand-authored quickstart JSONs must pick the right tier per canonical role (library default) to preserve primary-vs-subagent semantics. Plan 02-01 Task 3 includes an explicit per-quickstart tier-count assertion.
- `createWorkflowAgents` (`team/agents.ts:40`) maps `tier === 1 → primary`, `tier >= 2 → subagent`. Canonical shape preserves `tier: number`. Verify the tier-count per quickstart matches authorial intent.
- `workflow/build-runner.ts`, `reviewer.ts`, `escalation.ts` reference `TeamRole.capabilities: string[]`. Canonical shape uses `capabilities: CanonicalCapability[]` + `supplementaryCapabilities: string[]`. Audit every `role.capabilities.includes("..")` call site; convert to canonical enum value. Legacy `"coding"` → canonical `"implementation"`. `"code-review"` → `"review"`. `"ci"` → `"release"`. `"tests"` → `"testing"`.
- `escalation.ts findParentRole`: canonical quickstarts may have multiple tier-1 roles (e.g., coordinator + senior-dev in solo-enhanced). Tiebreak is insertion order. Plan 02-01 Task 3 includes a parent-role-determinism test asserting each quickstart's expected parent under `findParentRole`.
- **`Config.Info.team` schema flip (`config/config.ts:1499`)**: existing user `kilo.json` files with legacy `team:{...}` shape will fail parse once swapped. The migration doc describes manual migration via Node API. No backwards-compat shim.
- **Bun `--compile` JSON embedding**: `readFileSync(import.meta.dir/...)` does NOT auto-embed. Plan 02-01 uses static `import foo from "./foo.json" with { type: "json" }` — Bun's documented JSON-embedding path. Verification includes invoking the loader from the compiled binary (not just `--version`).
- Bundled JSON imports: tsgo + bun both support `with { type: "json" }` in TS 5.3+. Repo is on 5.6+.
- `TEAM_PRESETS` usage in test files: Plan 02-01 Task 1 pre-flight audits and documents every test-file usage; Plan 02-02 updates them as part of the consumer sweep.

## Architectural Approach Selected

**Fully clean break now, break extension** (chosen at planning step 3.5) — refined post-critique:

- Server route `GET /config/team/presets` serializes `QuickstartTemplate[]` wrapper shape. Devil-vscode webview will fail to parse this against its stale SDK-derived types → runtime break. Phase 9 flips SDK + extension.
- `team/presets.ts` deleted in full.
- Legacy halves of `config.ts` (legacy `TeamRole`, legacy `TeamConfig`, legacy `TeamRouting`) deleted. Legacy `ReactionRule` retained because `CanonicalTeamConfig.reactions` references it; keep as a standalone export.
- `fromLegacyTeamConfig` MOVED (not copied) from `config.ts` to `migration.ts` in Plan 02-01 Task 1. Plan 02-02 Task 2 no longer deletes from `config.ts` — already gone.
- The migration tool retains a narrow internal legacy schema (`LegacyParseTeamConfig` for parsing old JSON files). Exported from `migration.ts` as test-only (JSDoc `@internal` + not re-exported from `team/index.ts`) so test files can construct fixtures without pulling from deleted `TEAM_PRESETS`.
- **SDK is NOT regenerated.** `script/generate.ts` is explicitly out of scope for Phase 2. Devil-vscode typecheck stays clean against stale SDK types. This keeps Phase 2 CI-green, defers SDK regen + webview fix to Phase 9.

## Key Decisions

| Decision | Choice | Reference |
|---|---|---|
| Extension IPC boundary | Break extension at runtime until Phase 9; server returns canonical DTO; SDK stays stale (not regenerated) | Planning step 3.5 + critique AUTO_REFINE cycle 1 |
| `fromLegacyTeamConfig` location | MOVE from `config.ts` to `migration.ts` in Plan 02-01 (single-location) | Critique: move/copy contradiction resolved — single move |
| Quickstart bundling | Static JSON imports: `import solo from "./solo-enhanced.json" with { type: "json" }` in `quickstarts/index.ts`; loader re-exports typed objects | Critique: `readFileSync` + `import.meta.url` does not auto-embed in Bun compile |
| Loader verification | Probe must invoke `loadQuickstartTemplates()` from compiled binary, not `--version` | Critique: `--version` never triggers loader; false positive |
| `enabled: true` flip | Each quickstart hand-verified for 7-stage coverage + authorial tier match before enabling | Migration helper defaults `enabled: false`; quickstart author explicitly flips |
| Canonical-tier-overrides-legacy-tier | Documented; quickstart JSONs assign `tier` per canonical library default | Critique C4: silent primary/subagent drift without explicit rule |
| Test fixture retention | `migration.test.ts` constructs legacy fixtures via `LegacyParseTeamConfig.parse(rawObject)` — exported test-only from `migration.ts` | Critique N5: legacy `TeamConfig.parse` no longer available after deletion |
| Existing legacy tests in `canonical-config.test.ts` | Full removal of migration block (lines 264-712) + 2 legacy-regression tests (lines 719-738). Coverage relocated to `migration.test.ts`. | Critique N5 |
| Migration doc location | `packages/devil-docs/pages/collaborate/teams/migration-v1.md` | Matches Phase 6 docs target pattern |
| Migration doc migration method | Node API snippet (`import { migrateLegacyTeamConfigFile } from "@devilcode/opencode/devilcode/team/migration"`). **No `kilo team migrate` CLI subcommand in this phase.** Doc explicit about this. | Critique INFO: plan referenced CLI that wouldn't ship |
| `/team init` state source | `Config.update({team: quickstart.team})` — team lives in `kilo.json`, not WorkflowState | Critique A3/A4: WorkflowState has no team field; team source is `Config.get().team` |
| `WorkflowStateManager` changes | None. No new parameter. No schema change. Quickstart picker uses `Config.update`. | Critique N2: state-manager signature expansion was overscope |
| Commit boundary allowed | After Plan 02-02 Task 1 (consumer swap + server flip complete, legacy types still exist as dead code). Before Plan 02-02 Task 2 (deletions). | Critique N4: 12-file working tree too fragile for single task |
| Legacy removal scope | `presets.ts`, legacy `TeamRole`, legacy `TeamConfig`, legacy `TeamRouting`. Keep `ReactionRule` + `EffortLevel`. | Minimum-surface deletion |
| `/team init` rework scope | Quickstart selection via sub-commands `/team init <id>`; no-arg invocation lists the 5 options in a toast. Full picker UI deferred to Phase 4. | Avoid Phase 3/4 scope creep |
| Route paths | `/config/team/presets` + `/config/team/validate` (actual paths, not `/config/presets`) | Critique A2: plan had wrong path |
| SDK regeneration | **Not run in Phase 2.** Deferred to Phase 9 (which owns the extension flip). | Critique A1: running `./script/generate.ts` would cascade into devil-vscode typecheck failure, violating PH2-R6 |

## Plan Structure

| Plan | Wave | Depends On | Agents | Task Count |
|---|---|---|---|---|
| 02-01 Migration Tool + Quickstart JSON Templates | 1 | Phase 1 (landed) | Senior Developer (primary), QA Verification Specialist (reviewer) | 3 |
| 02-02 Clean-Break Removal + Consumer Flip + /team init + Docs | 2 | 02-01 | Senior Developer (primary), Backend Architect (reviewer) | 3 |

Wave 1 ships all new code + test-fixture relocation (migration module + quickstart JSONs + tests, with `canonical-config.test.ts` migration block moved). Wave 2 ships consumer swaps + deletions + server flip + docs with a commit boundary after consumer sweep.

## Open Questions

| # | Question | Resolution path |
|---|---|---|
| 1 | Do static JSON imports (`with { type: "json" }`) typecheck under tsgo + resolve under bun runtime? | Plan 02-01 Task 2 verifies both with a dry-run compile probe that actually invokes `loadQuickstartTemplates()` |
| 2 | Does `bun turbo typecheck` actually stay clean across devil-vscode after server flip without SDK regen? | Plan 02-02 Task 1 runs the full monorepo typecheck as part of the iterative verification loop; documented as a required success criterion |
| 3 | Are there test files beyond `canonical-config.test.ts` that import `TEAM_PRESETS`? | Plan 02-01 Task 1 pre-flight greps the full test tree and documents every import for Plan 02-02 to update |
| 4 | Does `Config.update({team: ...})` immediately propagate to `command-input.tsx`'s `Config.get().team` read? | Plan 02-02 Task 3 manual smoke test verifies; if the update does not propagate synchronously, add a config reload call in the quickstart picker |
| 5 | Does migrating `Config.Info.team` Zod field break existing user `kilo.json` files? | Yes — documented in migration doc; no backwards-compat shim |

## Related Artifacts

- Phase 1 context: `.planning/phases/01-foundation/01-CONTEXT.md`
- Phase 1 summaries: `.planning/phases/01-foundation/01-01-SUMMARY.md`, `01-02-SUMMARY.md`
- Phase 1 reconciliation: `.planning/phases/01-foundation/01-reconciliation.md`
- Project charter: `.planning/PROJECT.md`
- Roadmap: `.planning/ROADMAP.md`
- Codebase map: `.planning/CODEBASE.md`
- Critique AUTO_REFINE cycle 1 findings: embedded in plan file `_meta.critique_cycle_1` sections (see each plan's header for resolved-findings list)
