# Phase 1 Context — Foundation: Canonical Library & Capability Model

## Phase Goal

Lock the data model every later phase depends on: canonical 11-position library, canonical 8-value capability enum, stage→capability mapping, strict coverage validation on `TeamConfig`, and prior-spec reconciliation. Resolve the `retro` stage owner question.

## Requirements (from ROADMAP Phase 1 + spec)

- PH1-R1 — Canonical 11-position library exported from `team/library.ts`
- PH1-R2 — Canonical capability enum + stage→capability mapping in `team/capabilities.ts`
- PH1-R3 — `TeamConfig` schema extended with strict 7-stage coverage refinement
- PH1-R4 — Prior 2026-04-06 spec reconciled (`.planning/phases/01-foundation/01-reconciliation.md`)
- PH1-R5 — `retro` stage owner decided: Coordinator owns `retrospective` by default
- PH1-R6 — 100% unit test coverage on new schema validators

## Success Criteria

- `packages/opencode/src/devilcode/team/library.ts` exports 11 canonical positions with full metadata (tier, canonicalCapabilities, defaultCanDelegate, displayName, description)
- `packages/opencode/src/devilcode/team/capabilities.ts` exports 8-value canonical enum + `STAGE_CAPABILITY_REQUIREMENTS` covering all 7 stages
- `TeamConfig` Zod schema refinement rejects teams missing any stage's required capability, listing ALL missing stages in the error
- Compile-time exhaustiveness assertions pass `bun turbo typecheck` (uses `tsgo --noEmit`)
- All new tests pass: `cd packages/opencode && bun test test/kilocode/team/`
- No regressions in existing CLI test suite
- Reconciliation doc explicitly enumerates prior-spec claims with disposition
- Full monorepo typecheck clean after schema changes (downstream consumers like `agents.ts`, `presets.ts`, `router.ts` still compile — Phase 2 handles preset migration)

## Existing Assets (from CODEBASE.md + exploration)

### Files to read before editing
- `packages/opencode/src/devilcode/team/config.ts` — existing `TeamRole` + `TeamConfig` Zod schemas with 4 refinements (~73 LOC)
- `packages/opencode/src/devilcode/workflow/types.ts` — `WorkflowStage` enum (7 stages, line 3)
- `packages/opencode/src/devilcode/team/presets.ts` — 5 existing presets (migration target for Phase 2, touch-check only in Phase 1)
- `packages/opencode/src/devilcode/team/agents.ts` — `createWorkflowAgents` runtime glue (no changes expected)
- `docs/superpowers/specs/2026-04-06-workflow-tui-design.md` — prior spec (reconciliation target)
- `docs/superpowers/plans/2026-04-06-workflow-tui.md` — prior plan (reconciliation target)

### Conventions (from CODEBASE.md)
- Namespace modules, not classes; Zod schemas exported alongside `z.infer` types
- Co-located test files in `packages/opencode/test/kilocode/team/`
- Prettier: 120 char width, no semicolons
- `team/` is under `src/devilcode/` — **no `devilcode_change` markers needed**
- Bun native test runner; `cd packages/opencode && bun test <path>` to run targeted tests
- Type check: `bun turbo typecheck` (uses `tsgo`, not `tsc`); from package: `bun run typecheck`

### Risk Areas Overlap (from CODEBASE.md)
- `team/config.ts` currently at 73 LOC — adding ~22 LOC; low risk
- No overlap with HIGH-risk areas (`models-snapshot.ts`, fork markers hotspot, provider layer, session/prompt, LSP)
- Touch with care: CI enforces `bun turbo typecheck` monorepo-wide — changing `TeamRole.capabilities` type breaks any consumer. Run typecheck before marking Phase 1 complete. Downstream consumers identified: `team/agents.ts` (runtime glue — uses `capabilities` at `agents.ts:40` as part of agent options), `team/presets.ts` (all 5 presets declare `capabilities: ["..."]`), `team/router.ts` (routing logic). Phase 2 migrates `presets.ts`; Phase 1 must at minimum keep `agents.ts` + `router.ts` compiling.

## Architectural Approach Selected

**Clean** philosophy (chosen at planning step 3.5):
- `CanonicalCapability = z.enum(["planning","design","implementation","review","release","testing","research","retrospective"])` — 8 values
- `CanonicalPosition = z.enum([...11 kebab-case ids...])`
- `STAGE_CAPABILITY_REQUIREMENTS: Record<WorkflowStage, CanonicalCapability>` — `challenge` shares `planning` capability with `plan` stage
- `POSITION_CAPABILITY_MAP: Record<CanonicalPosition, CanonicalCapability>` — each position's primary capability
- `POSITION_LIBRARY` entries carry multi-capability `canonicalCapabilities: CanonicalCapability[]` (Coordinator has `[planning, retrospective]`)
- `TeamRole.capabilities: z.array(CanonicalCapability).nonempty()` + `supplementaryCapabilities: z.array(z.string()).default([])` + `positionId: CanonicalPosition`
- New refinement on `TeamConfig` collects all missing stages before erroring

## Key Decisions

| Decision | Choice | Reference |
|---|---|---|
| Schema philosophy | Clean (strong enums over strings) | Planning step 3.5 selection |
| Capability count | 8 canonical values | Spec Architecture table |
| Position count | 11 canonical (no 12th Retro Facilitator) | Exploration decision + planning step 3.5 |
| `retro` owner | Coordinator (primary: planning; secondary: retrospective) | Spec Key Decisions |
| `challenge` capability | Reuses `planning` | Spec Key Decisions (avoids enum bloat) |
| Backwards-compat | Clean break (no legacy shim) | PROJECT.md Constraints |
| Phase 2 migration | Deferred to Phase 2 (Phase 1 may leave TODO comments in `presets.ts` if necessary to keep typecheck green) | ROADMAP Phase 2 scope |

## Plan Structure

| Plan | Wave | Depends On | Agents | Task Count |
|---|---|---|---|---|
| 01-01 Capability Model & Reconciliation | 1 | — | Senior Developer (primary), Backend Architect (schema review) | 3 |
| 01-02 Position Library & TeamConfig Extension | 2 | 01-01 | Senior Developer (primary), QA Verification Specialist (coverage tests) | 3 |

## Open Questions (from spec)

| # | Question | Resolution path |
|---|---|---|
| 1 | Prior spec claims absent from Clean 8+11 decision? | Addressed in Plan 01-01 Task 1 (reconciliation) |
| 2 | Is `positionId` required on every `TeamRole`? | Default: Required. Custom positions deferred to Phase 8. Plan 01-02 Task 2 implements as required. |
| 3 | Does `createWorkflowAgents` need `positionId`? | No changes expected; verified in Plan 01-02 Task 3 (typecheck + test run) |
| 4 | Supplementary capability allowlist? | Deferred to Phase 8 |
| 5 | Coordinator's primary capability — `planning` or `retrospective`? | `planning` (Spec Key Decisions) |

## Related Artifacts

- Full spec: `.planning/specs/01-foundation-spec.md`
- Project charter: `.planning/PROJECT.md`
- Roadmap: `.planning/ROADMAP.md`
- Codebase map: `.planning/CODEBASE.md`
- Exploration record: `.planning/exploration-workflow-teams-redesign.md`
