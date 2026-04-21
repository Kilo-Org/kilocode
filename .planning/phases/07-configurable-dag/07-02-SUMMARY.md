# Plan 07-02 Summary: UI + Runtime Integration

## Result
**Status**: Complete
**Wave**: 2
**Agent**: engineering-frontend-developer
**Completed**: 2026-04-21

## Completed Tasks

### Task 1: devil-ui DAGEditor Primitive
- Created `devil-ui/src/primitives/dag-editor/types.ts` — local WorkflowDAG/Edge/DAGError types (R2-02: no cross-package import from @devilcode/cli)
- Created `devil-ui/src/primitives/dag-editor/index.tsx` — SolidJS DAGEditor component; renders stages + edge arrows; error highlighting for cycle/unreachable/self-loop; accessible (role="list", aria-live="polite")
- Edited `devil-ui/src/primitives/index.ts` — added `export * from "./dag-editor"`
- Edited `devil-ui/package.json` — added `"./primitives/dag-editor": "./src/primitives/dag-editor/index.tsx"` to exports map
- Created `devil-ui/src/stories/dag-editor.stories.tsx` — Default story (7-stage, readOnly) + WithErrors story (cycle highlighted)

### Task 2: Team Builder Integration
- Edited `workflow-tui/views/team-builder-context.tsx`:
  - Added state: `dagDraft: WorkflowDAG | null`, `dagErrors: DAGError[]`, `advancedMode: boolean`
  - Added actions: `setAdvancedMode()`, `updateDAG()` (R2-03: null-safety on roles), `resetDAGToDefault()`
  - `save()` and `validateAndStartBuild()` include `workflowOverride` when dagDraft valid + no errors
- Edited `workflow-tui/views/team-builder-view.tsx`:
  - Added TabGroup with "Roster" and "Workflow" tabs
  - Workflow tab: advanced mode checkbox toggle + DAGEditor (readOnly=true, v1 display-only) + Reset button
  - Import `DAGEditor` from `@devilcode/kilo-ui/primitives/dag-editor`
- Fixed `test/devilcode/workflow-tui/team-io.commands.test.ts` — pre-existing version assertion "1.0.0" → "1.1.0"

### Task 3: Runtime Dispatch + Final Tests
- Edited `workflow/index.ts` — `Workflow.nextStage()` accepts optional `dag?: WorkflowDAG`; delegates to `getNextStage()` for custom DAGs, falls back to `generateDefaultDAG()`
- Created `test/devilcode/workflow-tui/dag-runtime.test.ts` — 16 structural tests verifying DAG-driven stage sequencing across 3 configurations (default, skip-challenge, minimal)
- All CI gates verified: knip, format:check, check-devilcode-change clean

## Files Modified
- `packages/devil-ui/src/primitives/dag-editor/types.ts` — NEW: local WorkflowDAG/Edge/DAGError types
- `packages/devil-ui/src/primitives/dag-editor/index.tsx` — NEW: DAGEditor SolidJS component
- `packages/devil-ui/src/stories/dag-editor.stories.tsx` — NEW: Storybook stories
- `packages/devil-ui/src/primitives/index.ts` — EDIT: dag-editor export added
- `packages/devil-ui/package.json` — EDIT: dag-editor exports map entry
- `packages/opencode/src/devilcode/workflow-tui/views/team-builder-context.tsx` — EDIT: DAG state + actions
- `packages/opencode/src/devilcode/workflow-tui/views/team-builder-view.tsx` — EDIT: Workflow tab + DAGEditor
- `packages/opencode/src/devilcode/workflow/index.ts` — EDIT: nextStage() uses getNextStage() for custom DAGs
- `packages/opencode/test/devilcode/workflow-tui/dag-runtime.test.ts` — NEW: 16 runtime integration tests
- `packages/opencode/test/devilcode/workflow-tui/team-io.commands.test.ts` — EDIT: version assertion fix

## Verification Results
- `bun test test/devilcode/workflow-tui/dag-runtime.test.ts` — 16 pass, 0 fail, 16 expect() calls
- `bun test test/devilcode/` — 306 pass, 0 fail, 664 expect() calls
- `bun turbo typecheck` — 0 new errors (pre-existing devil-ui primitives + kilo-ui alias issues)
- `bun run knip` — clean
- `bun run format:check` — clean
- `bun run check-devilcode-change` — clean

## Verification Commands
| Command | Exit Code | Result |
|---------|-----------|--------|
| `bun test test/devilcode/workflow-tui/dag-runtime.test.ts` | 0 | PASS — 16 tests |
| `bun test test/devilcode/` | 0 | PASS — 306 total |
| `bun turbo typecheck` | 0 | PASS — 0 new errors |
| `cd packages/devil-vscode && bun run knip` | 0 | PASS — clean |
| `cd packages/devil-vscode && bun run format:check` | 0 | PASS — clean |
| `bun run check-devilcode-change` | 0 | PASS — clean |

## Key Decisions
1. **DAGEditor readOnly=true (v1)**: Visual edge editing deferred to Phase 9; v1 is display-only — prevents premature complexity
2. **Local type mirroring (R2-02)**: devil-ui defines WorkflowDAG/DAGError locally in `dag-editor/types.ts` — avoids circular cross-package dependency; Phase 9 may extract to `@devilcode/sdk`
3. **R2-03 null-safety**: `updateDAG()` checks `store.draft.roles` existence before iteration — guards against partially initialized state
4. **Workflow.nextStage() signature**: Optional `dag?: WorkflowDAG` parameter — null = use default DAG, non-null = custom DAG; no breaking change to existing callers
5. **Tab layout**: TabGroup "Roster" default, "Workflow" secondary — advanced mode gated behind checkbox within Workflow tab (two-level progressive disclosure)

## Issues Encountered
- Pre-existing version assertion in `team-io.commands.test.ts` ("1.0.0") — fixed in Wave 2 (version bump from Wave 1 broke it)
- Pre-existing typecheck errors in `devil-ui/src/primitives/` (4 errors: implicit `any`, `SpanProps` mismatches) — existed before Phase 7; no new errors introduced
- Pre-existing `@devilcode/kilo-ui` tsconfig alias issue — `@/*` paths not resolvable from devil-ui; unrelated to Phase 7

## Escalations
None.

## Handoff Context
- **Key outputs**: `devil-ui/primitives/dag-editor/` with stable public API; team-builder Workflow tab with advanced-mode DAG display; runtime dispatch uses `getNextStage()` for custom DAGs
- **Decisions made**: DAGEditor v1 is display-only (readOnly=true); local types in devil-ui; optional dag param on Workflow.nextStage()
- **Open questions**: None — all plan tasks completed
- **Phase 9 follow-up**: Extract shared types to `@devilcode/sdk`; add visual edge editing to DAGEditor; wire drag-and-drop stage reordering

## Requirements Covered
- devil-ui dag-editor primitive (07-02 Task 1)
- Team-builder Workflow tab with DAGEditor + advanced mode toggle (07-02 Task 2)
- Runtime dispatch uses getNextStage() for custom DAGs (07-02 Task 3)
- All CI gates pass (07-02 Task 3)
