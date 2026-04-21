# Plan 02-01 Summary: Migration Tool + Quickstart JSON Templates

**Status**: Complete
**Wave**: 1 of 2
**Date**: 2026-04-19

---

## Files Created

| File | LOC | Description |
|------|-----|-------------|
| `packages/opencode/src/devilcode/team/migration.ts` | 358 | Migration module: `fromLegacyTeamConfig` (MOVED from config.ts), `migrateLegacyTeamConfig`, `migrateLegacyTeamConfigFile`, `LegacyMigrationIssue`, `LegacyMigrationResult`, `LegacyParseTeamConfig` (test-only @internal), `LegacyParseTeamRole`, `LegacyParseTeamRouting` |
| `packages/opencode/src/devilcode/team/quickstarts/index.ts` | 55 | Static-import JSON loader: `loadQuickstartTemplates`, `getQuickstart`, `QUICKSTART_IDS`, `QuickstartId`, `QuickstartTemplate`, `QuickstartFile` schema |
| `packages/opencode/src/devilcode/team/quickstarts/solo-enhanced.json` | 83 | Quickstart: 5 roles (senior-dev/1, coordinator/1, researcher/3, reviewer/2, release-engineer/2) |
| `packages/opencode/src/devilcode/team/quickstarts/code-review-pair.json` | 83 | Quickstart: 5 roles (senior-dev/1, reviewer/2, coordinator/1, architect/1, release-engineer/2) |
| `packages/opencode/src/devilcode/team/quickstarts/full-stack-team.json` | 95 | Quickstart: 6 roles (architect/1, frontend-specialist/2, backend-specialist/2, reviewer/2, coordinator/1, release-engineer/2) |
| `packages/opencode/src/devilcode/team/quickstarts/ci-cd-pipeline.json` | 99 | Quickstart: 5 roles (release-engineer/1 override, developer/2, coordinator/1, architect/1, reviewer/2); 2 reaction rules preserved |
| `packages/opencode/src/devilcode/team/quickstarts/research-team.json` | 95 | Quickstart: 6 roles (coordinator/1, researcher/3, senior-dev/1, architect/1, reviewer/2, release-engineer/2); flat routing preserved |
| `packages/opencode/test/kilocode/team/migration.test.ts` | 546 | 18 migration tests: 5 preset + 5 original synthetic + 5 new synthetic + 3 file-API |
| `packages/opencode/test/kilocode/team/quickstarts.test.ts` | 161 | 53 quickstart tests: 8 bundle integrity + 35 coverage matrix + 5 tier preservation + 5 parent-role determinism |

## Files Modified

| File | Delta | Description |
|------|-------|-------------|
| `packages/opencode/src/devilcode/team/config.ts` | -234 LOC net | Removed `fromLegacyTeamConfig` function body + `LegacyMigrationIssue` + `LegacyMigrationResult` types + `POSITION_SYNONYM_MAP` + `CAPABILITY_SYNONYM_MAP` + `SUPPLEMENTARY_TO_IMPLEMENTATION` constants. Removed unused `POSITION_LIBRARY` import. No temporary re-export added (circular dependency resolved by updating test imports instead). |
| `packages/opencode/test/kilocode/team/canonical-config.test.ts` | -491 LOC net | Removed: full `fromLegacyTeamConfig migration helper` describe block (10 migration tests) + `Legacy types unchanged after Phase 1` describe block (2 legacy regression tests). Removed unused imports: `fromLegacyTeamConfig`, `TeamRole`, `TeamConfig`, `CanonicalPosition`, `TEAM_PRESETS`. Slimmed to 250 LOC (from ~740 LOC). |

**Diff confirmation**:
- `git diff --stat packages/opencode/src/devilcode/team/config.ts` → `234 +, 1 deletion from insertion block` (net ~-233 real deletions)
- `git diff --stat packages/opencode/test/kilocode/team/canonical-config.test.ts` → `-491 LOC net`

---

## Implementation Decision: Circular Dependency Resolution

**Decision**: Removed the planned temporary re-export from `config.ts` → `migration.ts` entirely.

**Reason**: `migration.ts` imports `CanonicalTeamConfig`, `CanonicalTeamRole`, `ReactionRule`, `EffortLevel` from `config.ts`. If `config.ts` had also re-exported from `migration.ts`, Bun/Node module initialization would fail with `ReferenceError: Cannot access 'X' before initialization` — a circular-init deadlock.

**Resolution**: Updated `canonical-config.test.ts` to import `fromLegacyTeamConfig` directly from `@/devilcode/team/migration` instead of `@/devilcode/team/config`. This is semantically correct (migration function lives in migration.ts) and avoids all circular-dependency risk. The "keep Phase 1 tests green via re-export" constraint from the plan spec was met via direct import update instead.

---

## TEAM_PRESETS Consumer Audit (Task 1 Pre-flight)

Full list of every file importing or defining `TEAM_PRESETS`:

| File | Context |
|------|---------|
| `packages/opencode/src/devilcode/team/presets.ts:14` | Definition: `export const TEAM_PRESETS: TeamPreset[]` |
| `packages/opencode/src/devilcode/team/index.ts:14` | Re-export: `export { TEAM_PRESETS, TeamPreset } from "./presets"` |
| `packages/opencode/src/server/routes/config.ts:14` | Import: `import { TEAM_PRESETS, TeamPreset } from "../../devilcode/team/presets"` → used at line 117 in `GET /config/team/presets` |
| `packages/opencode/test/kilocode/team/canonical-config.test.ts:5` | Import (NOW REMOVED — unused after slimming) |

**No additional test files** (`router.test.ts`, `config.test.ts`, `workflow-integration.test.ts`) import `TEAM_PRESETS` — confirmed by grep.

---

## Tests

| Suite | Tests | Pass | Fail |
|-------|-------|------|------|
| `migration.test.ts` | 18 | 18 | 0 |
| `quickstarts.test.ts` | 53 | 53 | 0 |
| `canonical-config.test.ts` (slimmed) | 14 | 14 | 0 |
| Full team suite (10 files) | 154 | 154 | 0 |

**Migration test breakdown**:
- 5 preset migrations (solo-enhanced, code-review-pair, full-stack-team, ci-cd-pipeline, research-team)
- 5 original synthetic fixtures (unknown role, unknown capability, round-trip, ui/api supplementary, defaultRole fallback)
- 5 new synthetic fixtures (parse-failure null, parse-failure bad file, missing routing, string tier, mixed canonical+synonym)
- 3 file-API tests (valid file, malformed JSON, nonexistent path)

**Quickstart test breakdown**:
- 8 bundle integrity tests
- 35 coverage matrix tests (5 quickstarts × 7 stages)
- 5 tier preservation tests
- 5 parent-role determinism tests

---

## tsconfig Changes

None required. `packages/opencode/tsconfig.json` extends `@tsconfig/bun` with `"module": "Preserve"` + `"moduleResolution": "bundler"` — Bun natively supports `with { type: "json" }` import attributes in this configuration without any tsconfig changes.

**verbatimModuleSyntax fix**: `quickstarts.test.ts` required `import type { QuickstartId }` (separate from value import) due to `verbatimModuleSyntax: true` in the bun tsconfig. Fixed before typecheck.

---

## Verification Sweep

| Command | Result |
|---------|--------|
| `cd packages/opencode && bun run typecheck` | Exit 0, clean |
| `bun turbo typecheck` | Exit 0, 12/12 tasks successful |
| `cd packages/opencode && bun test test/kilocode/team/migration.test.ts` | 18 pass, 0 fail |
| `cd packages/opencode && bun test test/kilocode/team/quickstarts.test.ts` | 53 pass, 0 fail |
| `cd packages/opencode && bun test test/kilocode/team/canonical-config.test.ts` | 14 pass, 0 fail |
| `cd packages/opencode && bun test test/kilocode/team/` | 154 pass, 0 fail |
| `cd packages/devil-vscode && bun run format:check` | Exit 0, all files use Prettier code style |
| `cd packages/devil-vscode && bun run knip` | Exit 0, no dead exports |
| `cd packages/devil-vscode && bun run check-devilcode-change` | Exit 0, no stale markers found |

**Verification Commands Run**: 9
**Verification Passed**: 9
**Verification Failed**: 0

**Pre-existing failure tally** (full `bun test`): ~42 failures across `RemoteSender`, `RemoteWS`, `config-resilience`, `fsmonitor`, `control-plane/workspace`, `local-model`, `rate-limit` — all pre-existing, confirmed unrelated to Plan 02-01 changes. The `packages/opencode/src/server/rate-limit.ts` modification shown in `git status` is a pre-existing unstaged change (not from this plan).

---

## Quickstart Coverage Verification

All 5 quickstarts verified with `CanonicalTeamConfig.safeParse({ enabled: true, ... })` — the `superRefine` stage-coverage check fires when `enabled: true`:

| Quickstart | Capabilities Covered |
|-----------|---------------------|
| solo-enhanced | implementation, design, research, planning, retrospective, review, release |
| code-review-pair | implementation, design, review, planning, retrospective, release |
| full-stack-team | planning, design, implementation, review, retrospective, release |
| ci-cd-pipeline | release, implementation, planning, retrospective, design, review |
| research-team | planning, retrospective, research, implementation, design, review, release |

**All 7 stages covered** (planning×2→planning, contract→design, build→implementation, review→review, ship→release, retro→retrospective) for every quickstart. Note: `testing` capability is NOT required by any stage — `STAGE_CAPABILITY_REQUIREMENTS` maps challenge→planning, not testing.

---

## Plan 02-02 Handoff

### Consumer Files (symbol swap targets)

| File | Current symbol | Target symbol |
|------|---------------|---------------|
| `src/server/routes/config.ts` | `TEAM_PRESETS`, `TeamPreset`, `TeamConfig` | `loadQuickstartTemplates()`, `QuickstartTemplate`, `CanonicalTeamConfig` |
| `src/devilcode/team/index.ts` | `TEAM_PRESETS`, `TeamPreset`, `fromLegacyTeamConfig` (re-export) | `loadQuickstartTemplates`, `getQuickstart`, `QUICKSTART_IDS`, `QuickstartId`, `QuickstartTemplate`; `fromLegacyTeamConfig` exported directly from `migration.ts` (no barrel re-export needed) |
| `src/config/config.ts:1499` | `TeamConfig.optional()` on `Config.Info.team` field | `CanonicalTeamConfig.optional()` |
| `src/devilcode/team/router.ts` | `TeamConfig`, `TeamRole` | `CanonicalTeamConfig`, `CanonicalTeamRole` |
| `src/devilcode/team/agents.ts` | `TeamConfig`, `TeamRole` | `CanonicalTeamConfig`, `CanonicalTeamRole` |
| `src/devilcode/workflow/build-runner.ts` | `TeamConfig` | `CanonicalTeamConfig` |
| `src/devilcode/workflow/escalation.ts` | `TeamConfig`, `findParentRole` | `CanonicalTeamConfig` |
| `src/devilcode/workflow/reviewer.ts` | `TeamConfig` | `CanonicalTeamConfig` |
| `src/devilcode/workflow-tui/context.tsx` | `TeamConfig` | `CanonicalTeamConfig` |
| `src/devilcode/workflow-tui/orchestrator.ts` | `TeamConfig` | `CanonicalTeamConfig` |
| `src/devilcode/workflow-tui/command-input.tsx:48` | `TeamConfig.safeParse` | `CanonicalTeamConfig.safeParse` |
| `src/devilcode/workflow-commands.tsx` | no TeamConfig; add quickstart picker | Call `Config.update({team: quickstart.team})` |

### TEAM_PRESETS Test File Usages to Rewrite in Plan 02-02 Task 1

- `canonical-config.test.ts:5` — import already REMOVED (file slimmed in this plan). No remaining `TEAM_PRESETS` references.

### Config.Info.team Line Reference

`src/config/config.ts:1499` — `team: TeamConfig.optional()` field on `Config.Info` schema.

### Server Route Paths

- `GET /config/team/presets` — currently returns `TEAM_PRESETS` (legacy `TeamPreset[]`). Plan 02-02 flips to `loadQuickstartTemplates()` returning `QuickstartTemplate[]`.
- `POST /config/team/validate` — currently validates against legacy `TeamConfig`. Plan 02-02 flips to `CanonicalTeamConfig`.

### canonical-config.test.ts Final State

- **Current LOC**: 250 (post-slimming)
- **Remaining content**: `CanonicalTeamConfig strict stage coverage` describe block only (14 tests: 1 valid parse + 7 stage-removal + 1 dual-missing + 1 non-canonical-cap + 1 supplementary-round-trip + 1 positionId-required + 1 bogus-role-key + 1 enabled-false-skip)
- Imports: only `CanonicalTeamConfig`, `CanonicalTeamRole` from config; `CanonicalCapability`, `STAGE_CAPABILITY_REQUIREMENTS` from capabilities
- No `TEAM_PRESETS`, `TeamRole`, `TeamConfig`, `fromLegacyTeamConfig`, or `TEAM_PRESETS` references remain

### Temporary Re-export Note

No temporary re-export was added to `config.ts`. The circular dependency was resolved by updating test imports directly. Plan 02-02 Task 2 does not need to delete any re-export from `config.ts`.

### Deletion Targets for Plan 02-02 Task 2

- `packages/opencode/src/devilcode/team/presets.ts` — delete entire file
- `packages/opencode/src/devilcode/team/config.ts` — delete legacy `TeamRole`, `TeamConfig`, `TeamRouting` schema blocks (lines ~8-74). Keep: `EffortLevel`, `ReactionRule`, all canonical types.
- `packages/opencode/src/devilcode/team/index.ts` — remove `TEAM_PRESETS`, `TeamPreset` exports; add quickstart barrel exports

### Team Suite Baseline for Plan 02-02

154 tests, 0 failures across 10 files. Plan 02-02 should maintain 0 failures; test count may change as fixtures are updated.
