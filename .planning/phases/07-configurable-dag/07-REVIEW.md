# Phase 7 Review: Configurable Workflow DAG

## Result
**Verdict**: PASS
**Cycles**: 3
**Review date**: 2026-04-21
**Reviewers**: testing-qa-verification-specialist · testing-test-results-analyzer

## Success Criteria Assessment

| Criterion | Status | Evidence |
|-----------|--------|----------|
| `TeamConfig.workflowOverride: DAGOverride` (schema + capabilityOverrides) | PASS | `config.ts` line 63; `DAGOverride` = `{ dag: WorkflowDAG, capabilityOverrides?: Record<string, CanonicalCapability[]> }`; round-trip with capabilityOverrides verified |
| DAG validator rejects cycles, unreachable, missing capabilities | PASS | Kahn's+BFS in `validator.ts`; 22 unit tests + true-cycle integration test through `safeParse` |
| Team-builder DAG editor (advanced mode, hidden by default) | PASS | Workflow tab + advancedMode checkbox gating DAGEditor; display-only v1 (readOnly=true intentional) |
| Runtime dispatch uses override when present; falls back to default | PASS | `resolveAction(stage, "next", dag?)` → `nextStage(stage, dag)` → `getNextStage(current, dag)`; command-input.tsx `/next` passes `team()?.workflowOverride?.dag` |
| 3+ synthetic non-default DAGs pass runtime integration tests | PASS | skip-challenge (6-stage), minimal (3-stage), cap-override-reordered (5-stage); all pass `validateDAG` + `getNextStage` traversal |

## Findings by Cycle

### Cycle 1 (NEEDS WORK)

**BLOCKERs fixed:**
- **F1**: `Workflow.nextStage("retro")` threw — `generateDefaultDAG()` linear, no retro→plan edge. Fixed: default path uses `STAGE_TRANSITIONS[current][0]` (preserves cyclic retro→plan).
- **F2**: `dag-runtime.test.ts` never called `Workflow.nextStage()` — runtime contract untested. Fixed: 4 new integration tests added including retro→plan regression guard.
- **F3**: `CanonicalTeamConfig.safeParse()` with `workflowOverride` never tested — superRefine dead code. Fixed: 3 tests in `integration.test.ts`.

**WARNINGs fixed:**
- **F4**: `Map<never, boolean>` wrong cast → `Map<CanonicalCapability, boolean>` with proper import.
- **F5**: `dagDraft: WorkflowDAG | null` loses `capabilityOverrides` → `dagDraft: DAGOverride | null`; `save()`/`validateAndStartBuild()` use `dagDraft` directly.
- **F6**: validator.test.ts missing duplicate-stages documentation test → added.
- **F7**: io.round-trip missing workflowOverride test → added.
- **F8**: Checksum verified on post-migration object → moved to pre-migration (`envelope.config`).
- **F9**: Capability override unknown-stage behavior untested → added.
- **F10**: versioning.test.ts missing v1.0.0 migration chain → added.
- **F11**: no-entry test lacked `not.toContain("cycle")` assertion → added.

**Suggestion fixed:**
- **F12**: DAGOverride shape deviation from ROADMAP spec undocumented → comment added to `schema.ts`.

### Cycle 2 (NEEDS WORK)

**BLOCKERs fixed:**
- **NI-1**: `resolveAction` had no `dag?` parameter — `/next` command in TUI ignored custom DAG entirely. Fixed: `resolveAction(stage, action, dag?)` threads to `nextStage(stage, dag)`; command-input.tsx reads `team()?.workflowOverride?.dag`.
- **Gap 1**: `capabilityOverrides` not in round-trip test fixture. Fixed: added `capabilityOverrides: { ship: ["release", "testing"] }` with direct assertion.

**WARNINGs fixed:**
- **NI-2**: `reset()` did not clear Phase 7 DAG state. Fixed: `dagDraft = null`, `dagErrors = []`, `advancedMode = false` added.
- **Gap 2**: "cyclic DAG" test actually hit `no-entry` path (both nodes in-degree 1). Fixed: added true-cycle test with valid entry + build↔review cycle; existing test renamed to describe actual `no-entry` path.

### Cycle 3 (PASS)

No new issues found. All five success criteria satisfied by direct code evidence.

**Observations logged (non-blocking):**
- DAGEditor `readOnly={true}` — interactive edge editing deferred to Phase 9 (documented in plan; intentional v1 decision).
- No dedicated test for `{ kind: "unreachable" }` — BFS code correct, gap in test coverage only; recommend adding in Phase 8 or Phase 9.
- F8 checksum fix runs on Zod-parsed `envelope.config`, not raw JSON — acceptable since `workflowOverride` has no default values, making Zod-parse and raw-JSON equivalent for current schema; hypothetical future risk documented.

## Final Test Counts

| Suite | Tests | Expect() | Notes |
|-------|-------|----------|-------|
| `test/devilcode/team/dag/` | 69 | — | schema + validator + helpers + integration |
| `test/devilcode/team/` | 152+ | — | all team tests |
| `test/devilcode/workflow-tui/` | 20 dag-runtime | — | including 4 Workflow.nextStage() integration tests |
| **Full `test/devilcode/`** | **318** | **682** | **0 fail** |

## CI Gates

| Gate | Result |
|------|--------|
| `bun turbo typecheck` | PASS — 0 new errors (pre-existing devil-ui errors unchanged) |
| `bun run knip` | PASS — clean |
| `bun run format:check` | PASS — clean |
| `bun run check-devilcode-change` | PASS — no stale markers |

## Files Produced / Modified (Phase 7 total)

### New source files
- `packages/opencode/src/devilcode/team/dag/schema.ts`
- `packages/opencode/src/devilcode/team/dag/validator.ts`
- `packages/opencode/src/devilcode/team/dag/helpers.ts`
- `packages/opencode/src/devilcode/team/dag/index.ts`
- `packages/devil-ui/src/primitives/dag-editor/types.ts`
- `packages/devil-ui/src/primitives/dag-editor/index.tsx`
- `packages/devil-ui/src/stories/dag-editor.stories.tsx`

### Modified source files
- `packages/opencode/src/devilcode/team/config.ts` — workflowOverride field + superRefine
- `packages/opencode/src/devilcode/team/versioning.ts` — v1.1.0 + migration registry
- `packages/opencode/src/devilcode/team/io.ts` — version check + checksum pre-migration
- `packages/opencode/src/devilcode/team/index.ts` — dag module exports
- `packages/opencode/src/devilcode/workflow/index.ts` — nextStage(dag?) + resolveAction(dag?)
- `packages/opencode/src/devilcode/workflow-tui/command-input.tsx` — /next passes effectiveDAG
- `packages/opencode/src/devilcode/workflow-tui/views/team-builder-context.tsx` — DAG state + actions + reset() fix
- `packages/opencode/src/devilcode/workflow-tui/views/team-builder-view.tsx` — Workflow tab + DAGEditor
- `packages/devil-ui/src/primitives/index.ts` — dag-editor export
- `packages/devil-ui/package.json` — dag-editor exports map entry

### New test files
- `packages/opencode/test/devilcode/team/dag/schema.test.ts`
- `packages/opencode/test/devilcode/team/dag/validator.test.ts`
- `packages/opencode/test/devilcode/team/dag/helpers.test.ts`
- `packages/opencode/test/devilcode/team/dag/integration.test.ts`
- `packages/opencode/test/devilcode/workflow-tui/dag-runtime.test.ts`

### Modified test files
- `packages/opencode/test/devilcode/team/versioning.test.ts`
- `packages/opencode/test/devilcode/team/io.test.ts`
- `packages/opencode/test/devilcode/team/io.round-trip.test.ts`
- `packages/opencode/test/devilcode/workflow-tui/team-io.commands.test.ts`

## Phase 9 Follow-up Items

- Extract shared DAG types to `@devilcode/sdk` (currently mirrored locally in devil-ui)
- Add visual edge editing to DAGEditor (currently readOnly=true)
- Wire drag-and-drop stage reordering in team-builder Workflow tab
- Add unreachable-stage test to validator coverage
