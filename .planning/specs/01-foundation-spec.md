# Spec: Phase 1 — Foundation — Canonical Library & Capability Model

## Overview

Phase 1 locks the data model every later phase depends on. Three deliverables: a canonical 11-position library (`team/library.ts`), a canonical capability enum + stage→capability mapping (`team/capabilities.ts`), and schema extensions to `TeamConfig` (`team/config.ts`). Schema design follows the **Clean** philosophy chosen during planning: strong enums everywhere, type narrowing via discriminated types, strict Zod refinement for 7-stage coverage validation. The phase also reconciles the prior 2026-04-06 workflow-tui design doc and resolves the `retro` stage owner question (Coordinator owns retrospective).

## Requirements

| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|---------------------|
| PH1-R1 | Canonical 11-position library exported from `team/library.ts` | Must | All 11 positions present with `id`, `displayName`, `canonicalCapability`, `tier`, `defaultCanDelegate`; exported as `CanonicalPosition` enum + `POSITION_LIBRARY: Record<CanonicalPosition, PositionLibraryEntry>`; unit tests assert enum exhaustiveness |
| PH1-R2 | Canonical capability enum + stage→capability mapping from `team/capabilities.ts` | Must | `CanonicalCapability` Zod enum (8 values); `STAGE_CAPABILITY_REQUIREMENTS: Record<WorkflowStage, CanonicalCapability>` covers all 7 stages; compile-time exhaustiveness check (`const _check: Record<WorkflowStage, CanonicalCapability> = STAGE_CAPABILITY_REQUIREMENTS`) passes `tsgo --noEmit`; unit tests assert every stage maps to a known capability |
| PH1-R3 | `TeamConfig` schema extended for strict stage coverage validation | Must | `TeamRole.capabilities: z.array(CanonicalCapability)` replaces stringly-typed array; new `supplementaryCapabilities: z.array(z.string()).default([])` field; new refinement in `TeamConfig` fails validation when any stage's required capability is absent from the team's roles; error message lists missing stages |
| PH1-R4 | Prior 2026-04-06 spec reconciled | Must | `.planning/phases/01-foundation/01-reconciliation.md` exists; enumerates every claim in the prior spec that is preserved, superseded, or rejected; any preserved invariants copied into this spec's Architecture section |
| PH1-R5 | `retro` stage owner decided | Must | Coordinator position owns `retrospective` capability by default; documented in `team/library.ts` via `POSITION_CAPABILITY_MAP.coordinator = "retrospective"`; `STAGE_CAPABILITY_REQUIREMENTS.retro = "retrospective"`; reconciliation doc notes alternative was "add 12th Retro Facilitator position" (rejected to honor 11-position decision from exploration) |
| PH1-R6 | 100% unit test coverage on new schema validators | Must | Tests in `packages/opencode/test/kilocode/team/` cover: capability enum membership, stage→capability map exhaustiveness, 11-position library completeness, `TeamConfig` valid-team happy path, `TeamConfig` missing-stage-coverage rejection for each of the 7 stages, `TeamConfig` invalid-capability rejection, supplementary-capability round-trip; all pass under `cd packages/opencode && bun test test/kilocode/team/` |

## Architecture

### Data model

The Phase 1 schema has three axes:

1. **Positions** — canonical role taxonomy (11 values). Each position has a primary `canonicalCapability` plus a list of default capabilities used when a user drops the position into a team. Positions live in `team/library.ts` both as a Zod enum (`CanonicalPosition`) and a registry (`POSITION_LIBRARY`).
2. **Capabilities** — what a role *can do* (8 canonical values). Positions claim capabilities; the stage→capability mapping describes what each workflow stage *requires*. A team is valid when every stage's required capability is held by at least one role. Supplementary capabilities (free-form strings) travel alongside canonical capabilities for domain-specific tagging without code churn.
3. **Stages** — the 7 fixed workflow stages from `workflow/types.ts:3` (`plan | challenge | contract | build | review | ship | retro`). These are *not* changed in Phase 1. Phase 7 adds optional per-team override; Phase 1 only encodes the default mapping.

### Validation flow

```
TeamConfig.parse(input)
  ├── existing refinement: routing.defaultRole in roles
  ├── existing refinement: canDelegate references exist
  ├── existing refinement: parentRole (if set) in roles
  ├── existing refinement: reviewEscalationRole (if set) in roles
  └── NEW refinement: every STAGE_CAPABILITY_REQUIREMENTS[stage] is held by some role
```

The new refinement iterates `Object.values(STAGE_CAPABILITY_REQUIREMENTS)` and asserts at least one role in `cfg.roles` has that capability in its `capabilities` array. Error path: `["roles"]`. Error message: `"Team missing coverage for stages: {list}"` where `{list}` enumerates stages lacking a matching capability (not just one).

### Key Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|------------------------|
| Capability typing | `z.enum(8 canonical)` + `supplementaryCapabilities: z.array(z.string())` | Compile-time exhaustiveness; matches user's "canonical enum + free-form" decision from exploration | Stringly-typed (Minimal): contradicted user; Pragmatic (7-value matching stages 1:1): rejected in favor of semantic naming ("design" clearer than "contracting") |
| Position ID typing | `z.enum(11 canonical)` | Strongest type safety; IDE autocomplete; exhaustive switch over positions | String + registry lookup (Pragmatic): blocked by user's Clean choice; revisit if Phase 8 registry requires custom positions — migrate enum → string at that point |
| Canonical capability values | `planning, design, implementation, review, release, testing, research, retrospective` (8) | Semantic naming independent of stage names; enables capability reuse across stages (e.g., `planning` covers both plan and challenge) | 7 values matching stages 1:1: rejected for conflating "what it is" with "when it's used" |
| Stage→capability mapping | Static `Record<WorkflowStage, CanonicalCapability>` | Compile-time exhaustiveness; single source of truth; Phase 7 layers `workflowOverride` on top without changing this constant | Per-team configurable in Phase 1: rejected as premature (Phase 7 handles this) |
| `retro` stage owner | Coordinator owns `retrospective` (plus `planning`) | Honors 11-position library decision from exploration; retro is handoff + lessons capture, a natural Coordinator duty | 12th Retro Facilitator position: rejected (expands library); Release Engineer: rejected (ship ≠ retro); Architect-owned: rejected (dilutes planning role) |
| `challenge` stage capability | Maps to `planning` (shared with `plan` stage) | Challenge is adversarial re-planning; same capability skill set; keeps canonical count at 8 | Dedicated `challenge` capability: rejected as it creates enum bloat for a skill that is "planning with a skeptical hat" |
| Position → capability cardinality | Each position has ONE primary capability; capabilities array may hold more | Primary capability drives default stage assignment; multiple capabilities allow a role to cover extra stages (e.g., Coordinator covers both plan and retro) | Position = single capability: rejected (Coordinator needs both planning and retrospective) |
| Validation error UX | Error lists ALL missing stages, not the first | User can fix all gaps in one edit instead of whack-a-mole | First-failure error: rejected on UX grounds |
| TS exhaustiveness | Compile-time `const _check: Record<WorkflowStage, CanonicalCapability> = STAGE_CAPABILITY_REQUIREMENTS` | Fails `tsgo --noEmit` if a new stage is added without updating the mapping | Runtime-only check: rejected (too late) |

### File relationships

```
workflow/types.ts   (WorkflowStage enum — unchanged)
    │
    ▼
team/capabilities.ts  (CanonicalCapability enum + STAGE_CAPABILITY_REQUIREMENTS)
    │
    ├──► team/library.ts  (CanonicalPosition enum + POSITION_LIBRARY + POSITION_CAPABILITY_MAP)
    │        │
    │        ▼
    │    team/config.ts  (TeamRole, TeamConfig — extended)
    │        │
    │        ▼
    │    team/agents.ts  (createWorkflowAgents — NO CHANGE expected)
    │
    └──► team/presets.ts  (migrated to use CanonicalCapability — Phase 2 converts to JSON quickstart templates)
```

Refinement dependency chain (imports):
- `config.ts` imports from `capabilities.ts` (CanonicalCapability, STAGE_CAPABILITY_REQUIREMENTS)
- `library.ts` imports from `capabilities.ts` (CanonicalCapability)
- Neither `config.ts` nor `capabilities.ts` imports from `library.ts` — library depends on config's TeamRole shape, not the other way around

### Convention notes (from CODEBASE.md)

- Namespace modules, not classes. Zod schemas exported alongside `z.infer` types.
- Prettier: 120 char width, no semicolons (CI-enforced for `packages/devil-vscode/`, convention elsewhere).
- Tests co-located or mirrored in `test/kilocode/team/`.
- No `devilcode_change` markers needed: `team/` is under `src/devilcode/` (entirely Kilo).

## Deliverables

### `packages/opencode/src/devilcode/team/capabilities.ts`
- **Path:** `packages/opencode/src/devilcode/team/capabilities.ts`
- **Purpose:** Canonical capability enum + stage→capability mapping. Single source of truth for what a workflow stage requires from a role.
- **Key Content:**
  - `CanonicalCapability` — `z.enum(["planning","design","implementation","review","release","testing","research","retrospective"])` + `z.infer` type
  - `STAGE_CAPABILITY_REQUIREMENTS: Record<WorkflowStage, CanonicalCapability>` — literal const object; `plan→planning`, `challenge→planning`, `contract→design`, `build→implementation`, `review→review`, `ship→release`, `retro→retrospective`
  - Compile-time exhaustiveness assertion: `const _check: Record<WorkflowStage, CanonicalCapability> = STAGE_CAPABILITY_REQUIREMENTS`
  - Helper: `requiredCapabilitiesFor(stages: WorkflowStage[]): CanonicalCapability[]` for consumers
- **Dependencies:** `zod`, `workflow/types` (for `WorkflowStage`)
- **Estimated Size:** ~50 LOC + JSDoc

### `packages/opencode/src/devilcode/team/library.ts`
- **Path:** `packages/opencode/src/devilcode/team/library.ts`
- **Purpose:** Canonical 11-position library. Defines the semantic role taxonomy users pick from when building teams.
- **Key Content:**
  - `CanonicalPosition = z.enum([...11 kebab-case ids...])` with `z.infer` type
  - `PositionLibraryEntry = z.object({ id: CanonicalPosition, displayName: z.string(), tier: z.number().int().positive(), canonicalCapabilities: z.array(CanonicalCapability).nonempty(), defaultCanDelegate: z.array(CanonicalPosition).default([]), description: z.string() })`
  - `POSITION_LIBRARY: Record<CanonicalPosition, PositionLibraryEntry>` — const with all 11 entries; Coordinator's `canonicalCapabilities` includes `"planning"` and `"retrospective"`
  - `POSITION_CAPABILITY_MAP: Record<CanonicalPosition, CanonicalCapability>` — each position's PRIMARY capability (single value); used by UI to show "this position is the default for X stage"
  - Compile-time exhaustiveness: `const _libCheck: Record<CanonicalPosition, PositionLibraryEntry> = POSITION_LIBRARY`
- **Dependencies:** `zod`, `./capabilities`
- **Estimated Size:** ~120 LOC including 11 position entries + descriptions

### `packages/opencode/src/devilcode/team/config.ts` (modified)
- **Path:** `packages/opencode/src/devilcode/team/config.ts`
- **Purpose:** Extend `TeamRole` and `TeamConfig` with canonical capability typing and strict stage-coverage validation.
- **Key Content:**
  - `TeamRole.capabilities: z.array(z.string())` → `TeamRole.capabilities: z.array(CanonicalCapability).nonempty()`
  - New `TeamRole.supplementaryCapabilities: z.array(z.string()).default([])`
  - New `TeamRole.positionId: CanonicalPosition` — ties a role to a library entry (enables stage→position mapping display in TUI)
  - New refinement on `TeamConfig`: iterates `STAGE_CAPABILITY_REQUIREMENTS`; for each `[stage, cap]`, asserts `Object.values(cfg.roles).some(r => r.capabilities.includes(cap))`; collects all missing stages into one error message
  - Existing refinements preserved (defaultRole, canDelegate, parentRole, reviewEscalationRole)
- **Dependencies:** `zod`, `./capabilities`, `./library`
- **Estimated Size:** ~95 LOC (up from 73) — +22 LOC delta

### `packages/opencode/test/kilocode/team/capabilities.test.ts`
- **Path:** `packages/opencode/test/kilocode/team/capabilities.test.ts`
- **Purpose:** Unit tests for `capabilities.ts`.
- **Key Content:** Enum membership test (exactly 8 values, all expected); stage→capability mapping exhaustiveness (all 7 stages present, no extras); `requiredCapabilitiesFor` helper smoke test.
- **Dependencies:** Bun test runner, `bun:test`
- **Estimated Size:** ~40 LOC

### `packages/opencode/test/kilocode/team/library.test.ts`
- **Path:** `packages/opencode/test/kilocode/team/library.test.ts`
- **Purpose:** Unit tests for `library.ts`.
- **Key Content:** Exactly 11 positions; each position has `id === key`; Coordinator carries both `planning` and `retrospective`; `POSITION_CAPABILITY_MAP` values all in `CanonicalCapability`; `defaultCanDelegate` references exist in library.
- **Dependencies:** Bun test runner, `bun:test`
- **Estimated Size:** ~50 LOC

### `packages/opencode/test/kilocode/team/config.test.ts` (modified)
- **Path:** `packages/opencode/test/kilocode/team/config.test.ts`
- **Purpose:** Extend existing config tests with strict stage-coverage cases.
- **Key Content:** Happy-path team with all 7 stages covered; each of 7 tests removes one required capability and asserts the rejection message names the right stages; invalid canonical capability value rejected; `supplementaryCapabilities` round-trip preserved; legacy stringly-typed input rejected with a helpful message (sets up Phase 2 migration work).
- **Dependencies:** Bun test runner, existing config test file
- **Estimated Size:** +100 LOC (if file doesn't exist, ~150 LOC; Phase 2 migration tests live in a separate file)

### `.planning/phases/01-foundation/01-reconciliation.md`
- **Path:** `.planning/phases/01-foundation/01-reconciliation.md`
- **Purpose:** Enumerate claims in `docs/superpowers/specs/2026-04-06-workflow-tui-design.md` and mark each as preserved, superseded, or rejected. Preserve any invariants the prior spec established that this spec would otherwise miss.
- **Key Content:** Read the prior spec + its plan doc (`docs/superpowers/plans/2026-04-06-workflow-tui.md`); tabulate each design claim with disposition; cross-reference with this Phase 1 spec; list any invariants now added to this spec's Architecture section.
- **Dependencies:** none (doc task)
- **Estimated Size:** ~200-300 LOC markdown

## Open Questions

| # | Question | Impact | Default if Unresolved |
|---|----------|--------|-----------------------|
| 1 | Does the prior 2026-04-06 design spec introduce any capabilities or positions absent from the Clean 8+11 decision? | Blocking for Phase 1 implementation | If reconciliation surfaces extra items: append them to the library/capability enums at end of Phase 1; if contradictions: document in reconciliation doc and favor the Clean decision |
| 2 | Should `positionId` be required on every `TeamRole`, or optional (to allow custom roles that don't match the 11-library)? | Blocking | Required. Custom positions deferred to Phase 8 (registry). Phase 1 migration tool (Phase 2) assigns `positionId` to every existing preset role. |
| 3 | Does `createWorkflowAgents` (`team/agents.ts`) need to read the new `positionId` field to change how it instantiates agents? | Deferrable | No change expected: `createWorkflowAgents` uses `tier` to decide primary vs subagent. `positionId` is metadata for UI display. Revisit in Phase 5 if the cockpit needs it. |
| 4 | Should supplementary capabilities be validated against a separate allowlist per team, or accept any string? | Deferrable | Accept any string in Phase 1. Teams self-police via review. Phase 8 (registry) may add a team-scoped allowlist. |
| 5 | Coordinator's primary capability in `POSITION_CAPABILITY_MAP` — `planning` or `retrospective`? | Deferrable | `planning` (matches primary use case of orchestrating the workflow). Coordinator is only position with two canonical capabilities; UI uses the full `canonicalCapabilities` list when computing stage coverage. |

## Complexity Assessment

(To be filled by Section 5 of spec pipeline — deferred; `--auto-refine` plan critique in step 8.5 covers risk assessment.)

## Path Validation

**Status:** All paths valid (Devil Code conventions honored)
- `team/*.ts` → `packages/opencode/src/devilcode/team/` (existing Kilo-specific subdir; no `devilcode_change` markers needed)
- `team/*.test.ts` → `packages/opencode/test/kilocode/team/` (convention: Kilo tests mirror source in `test/kilocode/`)
- `.planning/phases/01-foundation/` → Legion convention
