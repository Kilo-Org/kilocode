# Plan 07-01 Summary: DAG Module + Schema Integration

## Result
**Status**: Complete with Warnings
**Wave**: 1
**Agent**: engineering-backend-architect
**Completed**: 2026-04-21

## Completed Tasks

### Task 1: Schema + Validator
- Created `team/dag/schema.ts` with `WorkflowDAG`, `WorkflowDAGEdge`, `DAGOverride` Zod schemas
- `capabilityOverrides` uses `z.record(z.string(), ...)` with `.refine()` per R1-01
- Created `team/dag/validator.ts` with Kahn's algorithm cycle detection, all 7 DAGError types, and `formatDAGError()` per R1-02
- Validator splits reachability (BFS) from cycle detection (Kahn's) for more precise diagnostics
- 13 schema tests + 22 validator tests

### Task 2: Helpers + Config Integration
- Created `team/dag/helpers.ts` with `getNextStage()`, `getEntryStage()`, `generateDefaultDAG()`
- Created `team/dag/index.ts` barrel
- Edited `team/config.ts`: added `workflowOverride: DAGOverride.optional()` + DAG validation in `superRefine`
- Edited `team/index.ts`: added Phase 7 dag exports (explicit named re-exports to avoid knip violations)
- 12 helper tests

### Task 3: Versioning + Integration Tests
- Bumped `CURRENT_TEAM_CONFIG_VERSION` to `"1.1.0"` in `team/versioning.ts`
- Added identity migration entry `"1.0.0"` → `"1.1.0"` (additive change)
- Loosened `io.ts` version check: uses `TeamConfigVersion.safeParse()` so 1.0.0 envelopes migrate cleanly
- Updated version assertions in `versioning.test.ts`, `io.test.ts`, `io.round-trip.test.ts`
- 17 integration tests across 3 synthetic DAGs (skip-challenge, minimal, with-capability-override)

## Files Modified
- `packages/opencode/src/devilcode/team/dag/schema.ts` — NEW: WorkflowDAG/Edge/Override schemas
- `packages/opencode/src/devilcode/team/dag/validator.ts` — NEW: validateDAG() + formatDAGError() + all DAGError types
- `packages/opencode/src/devilcode/team/dag/helpers.ts` — NEW: getNextStage(), getEntryStage(), generateDefaultDAG()
- `packages/opencode/src/devilcode/team/dag/index.ts` — NEW: barrel exports
- `packages/opencode/src/devilcode/team/config.ts` — EDIT: workflowOverride field + superRefine DAG validation
- `packages/opencode/src/devilcode/team/versioning.ts` — EDIT: version 1.1.0 + migration registry
- `packages/opencode/src/devilcode/team/io.ts` — EDIT: version check uses TeamConfigVersion.safeParse()
- `packages/opencode/src/devilcode/team/index.ts` — EDIT: dag module exports added
- `packages/opencode/test/devilcode/team/dag/schema.test.ts` — NEW: 13 tests
- `packages/opencode/test/devilcode/team/dag/validator.test.ts` — NEW: 22 tests
- `packages/opencode/test/devilcode/team/dag/helpers.test.ts` — NEW: 12 tests
- `packages/opencode/test/devilcode/team/dag/integration.test.ts` — NEW: 17 tests
- `packages/opencode/test/devilcode/team/versioning.test.ts` — EDIT: version assertion updated
- `packages/opencode/test/devilcode/team/io.test.ts` — EDIT: version assertions updated
- `packages/opencode/test/devilcode/team/io.round-trip.test.ts` — EDIT: version assertion updated

## Verification Results
- `bun test test/devilcode/team/dag/` — 64 pass, 0 fail, 93 expect() calls
- `bun test test/devilcode/team/` — 145 pass, 0 fail, 274 expect() calls
- `bun turbo typecheck` — 4 pre-existing errors in devil-ui primitives; zero new errors introduced

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `bun test test/devilcode/team/dag/schema.test.ts` | 0 | PASS — 13 tests |
| `bun test test/devilcode/team/dag/validator.test.ts` | 0 | PASS — 22 tests |
| `bun test test/devilcode/team/dag/helpers.test.ts` | 0 | PASS — 12 tests |
| `bun test test/devilcode/team/dag/integration.test.ts` | 0 | PASS — 17 tests |
| `bun test test/devilcode/team/dag/` | 0 | PASS — 64 total |
| `bun test test/devilcode/team/` | 0 | PASS — 145 total |
| `bun turbo typecheck` | 0 | PASS — 0 new errors (4 pre-existing devil-ui) |
| `grep CURRENT_TEAM_CONFIG_VERSION packages/opencode/src/devilcode/team/versioning.ts` | 0 | PASS — "1.1.0" |

## Key Decisions
1. **Kahn's + BFS split**: Ran BFS reachability first, then Kahn's only on reachable nodes — gives precise `unreachable` vs `cycle` diagnostics
2. **io.ts version check**: Loosened to `TeamConfigVersion.safeParse()` so 1.0.0 envelopes flow through migration pipeline cleanly
3. **index.ts exports**: Used explicit named re-exports (not `export * from "./dag"`) to avoid knip dead-export violations
4. **validateDAG signature**: Accepts `Map<CanonicalCapability, boolean>` per spec; config.ts integration builds this from role capabilities arrays

## Issues Encountered
Pre-existing typecheck errors in `devil-ui/src/primitives/` (4 errors: implicit `any` and `SpanProps` mismatches) — existed before Phase 7, confirmed by stash check. Track as pre-existing debt for Phase 9.

## Escalations
None.

## Handoff Context
- **Key outputs**: `team/dag/` module with stable public API; `getNextStage()` ready for runtime dispatch; `generateDefaultDAG()` provides default fallback
- **Decisions made**: io.ts version check uses safeParse (not hard equality); explicit named exports in index.ts barrel
- **Open questions**: None — all plan tasks completed
- **Conventions established**: DAG types use local `Stage = z.infer<typeof WorkflowStage>` alias; validator accepts `Map<CanonicalCapability, boolean>` for role capabilities

## Requirements Covered
- TeamConfig supports workflowOverride (07-01 Task 2)
- DAG validator (cycles, reachability, capabilities) (07-01 Task 1)
- 3 synthetic non-default DAG tests (07-01 Task 3)
