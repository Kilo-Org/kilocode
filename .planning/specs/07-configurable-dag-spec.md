# Phase 7 — Configurable Workflow DAG — Spec

**Status**: Draft · 2026-04-21
**Complexity**: Medium (new team/dag/ module + devil-ui primitive + runtime integration)
**Architecture**: Clean (selected by user; separate modules, explicit edges, reusable UI)
**Estimated LOC**: Source ~350 · Tests ~250
**Plans**: 2 waves (per ROADMAP)

---

## 1. Goal & Scope

### In Scope
- New `team/dag/` module with schema, validator, builder
- `WorkflowDAG` Zod schema with explicit stages + edges
- `DAGOverride` schema composable with `CanonicalTeamConfig`
- `validateDAG()` function with rich error types (cycle, unreachable, missing-capability)
- Cycle detection via Kahn's algorithm (BFS topological sort)
- Reachability check (all stages reachable from entry)
- Capability coverage validation against team roles
- Runtime dispatch integration — use override when present, fallback to default
- devil-ui `dag-editor` primitive (read-only viz + advanced edit mode)
- Team-builder integration (advanced mode toggle, hidden by default)
- Version bump to 1.1.0 in Phase 6 versioning pipeline
- At least 3 synthetic non-default DAGs in integration tests

### Out of Scope
- Conditional branching (edges with runtime conditions) — schema supports optional `condition` field but runtime ignores it in v1
- Visual graph library (D3, dagre) — use CSS-based layout for v1
- Multi-path parallel stage execution — sequential only in v1
- Stage timeout configuration per DAG node
- DAG templates beyond the 7-stage default

### Non-Goals
- Breaking change to existing team configs — `workflowOverride` is optional
- Phase 8 registry manifest changes — DAG travels inside existing envelope
- VS Code webview DAG editor — Phase 9 consumes devil-ui primitive

---

## 2. Research Findings

### Q1. Cycle detection algorithm

**Finding**: Kahn's algorithm (BFS-based topological sort) is O(V+E), simple, and returns cycle participants when sort fails. DFS-based detection is equivalent complexity but harder to extract cycle path.

**Decision**: Use Kahn's algorithm. If topological sort completes with fewer nodes than input, remaining nodes form cycle(s). Return `DAGError { kind: "cycle", nodes: [...] }`.

### Q2. Edge representation

**Finding**: Two options:
1. Implicit edges from array order (MINIMAL proposal)
2. Explicit `{ from, to }` edges (CLEAN proposal)

Explicit edges enable:
- Non-linear DAGs (e.g., skip `challenge` stage)
- Future conditional branching
- Clear validation errors ("edge from X to Y creates cycle")

**Decision**: Explicit edges. Schema:
```ts
WorkflowDAGEdge = { from: WorkflowStage, to: WorkflowStage, condition?: string }
```
Implicit default DAG = `plan→challenge→contract→build→review→ship→retro` edges generated at validation time when `edges` array is empty.

### Q3. Version bump strategy

**Finding**: Phase 6 `CURRENT_TEAM_CONFIG_VERSION = "1.0.0"`. Adding `workflowOverride` is additive (existing configs parse unchanged) but represents a schema evolution.

**Decision**: Bump to `1.1.0`. Migration pipeline in `versioning.ts` gains `"1.0.0" → "1.1.0"` entry (identity — no transformation needed, just version stamp). Envelope checksum recomputed on export.

### Q4. Capability override semantics

**Finding**: Current `STAGE_CAPABILITY_REQUIREMENTS` maps each stage to exactly ONE capability. Override could map to:
1. Single capability (same as default)
2. Array of capabilities (any matching role can execute)

**Decision**: Array of capabilities. Schema:
```ts
capabilityOverrides?: Partial<Record<WorkflowStage, CanonicalCapability[]>>
```
If a stage has no override, fall back to `STAGE_CAPABILITY_REQUIREMENTS[stage]` as a single-element array.

### Q5. UI placement

**Finding**: Team-builder (`team-builder-context.tsx`) has state for draft config. Phase 5 added TabGroup primitive. DAG editor could be:
1. New tab in team-builder
2. Collapsible section in existing roster view
3. Separate modal

**Decision**: New "Workflow" tab in team-builder (alongside Roster tab). Hidden by default; shown when user toggles "Advanced mode". devil-ui primitive `dag-editor/` is stateless; team-builder passes DAG + onChange callback.

### Q6. Entry stage validation

**Finding**: Kahn's algorithm requires identifying entry node(s) (nodes with in-degree 0). Default workflow has `plan` as entry. Custom DAG could have multiple entries (parallel starts) but runtime doesn't support parallel stage execution.

**Decision**: Exactly one entry stage required. Validation rejects DAGs with 0 or 2+ entry nodes. Entry = node with in-degree 0 in edges graph. Error: `DAGError { kind: "multiple-entries", stages: [...] }` or `{ kind: "no-entry" }`.

### Q7. Runtime dispatch integration

**Finding**: `WorkflowOrchestrator.advanceStage()` calls `Workflow.advanceStage()` which reads from `WorkflowStateManager`. Stage sequence is currently hardcoded in the TUI (`["plan", "challenge", "contract", "build", "review", "ship", "retro"]`).

**Decision**: Add `getNextStage(current: WorkflowStage, dag?: WorkflowDAG): WorkflowStage | null` helper in `team/dag/`. TUI calls this instead of hardcoded array index. Returns `null` at terminal node (retro or custom exit).

### Q8. Devil-ui primitive scope

**Finding**: Phase 5 primitives (DensityProvider, TabGroup, DetailPanel) are in `primitives/` with index.tsx + tests + stories pattern.

**Decision**: New `primitives/dag-editor/` with:
- `index.tsx` — component
- `types.ts` — props interface
- Storybook story
- Unit test (structural, not visual)

Component is DOM-only (no terminal branch needed — team-builder is DOM context).

---

## 3. Architecture Decisions

### 3.1 Module structure

```
packages/opencode/src/devilcode/team/dag/
  schema.ts          ← WorkflowDAG, WorkflowDAGEdge, DAGOverride Zod schemas
  validator.ts       ← validateDAG(), DAGError union type
  helpers.ts         ← getNextStage(), getEntryStage(), generateDefaultDAG()
  index.ts           ← Public API barrel

packages/devil-ui/src/primitives/dag-editor/
  index.tsx          ← DAGEditor component
  types.ts           ← DAGEditorProps

packages/opencode/src/devilcode/team/
  config.ts          ← EDIT: add workflowOverride?: DAGOverride
  versioning.ts      ← EDIT: bump to 1.1.0, add migration entry

packages/opencode/src/devilcode/workflow-tui/views/
  team-builder-context.tsx  ← EDIT: add dagDraft state
  team-builder.tsx          ← EDIT: add Workflow tab with DAGEditor
```

### 3.2 Schema design

```typescript
// team/dag/schema.ts
import z from "zod"
import { WorkflowStage } from "../../workflow/types"
import { CanonicalCapability } from "../capabilities"

export const WorkflowDAGEdge = z.object({
  from: WorkflowStage,
  to: WorkflowStage,
  condition: z.string().optional(), // Reserved for Phase 9+
})
export type WorkflowDAGEdge = z.infer<typeof WorkflowDAGEdge>

export const WorkflowDAG = z.object({
  stages: z.array(WorkflowStage).nonempty(),
  edges: z.array(WorkflowDAGEdge).default([]),
})
export type WorkflowDAG = z.infer<typeof WorkflowDAG>

export const DAGOverride = z.object({
  dag: WorkflowDAG,
  capabilityOverrides: z.record(WorkflowStage, z.array(CanonicalCapability)).optional(),
})
export type DAGOverride = z.infer<typeof DAGOverride>
```

### 3.3 Error types

```typescript
// team/dag/validator.ts
export type DAGError =
  | { kind: "cycle"; nodes: WorkflowStage[] }
  | { kind: "unreachable"; stages: WorkflowStage[] }
  | { kind: "missing-capability"; stage: WorkflowStage; required: CanonicalCapability[] }
  | { kind: "no-entry" }
  | { kind: "multiple-entries"; stages: WorkflowStage[] }
  | { kind: "unknown-stage"; stage: string }
  | { kind: "self-loop"; stage: WorkflowStage }

export function validateDAG(
  dag: WorkflowDAG,
  roleCapabilities: Map<CanonicalCapability, boolean>,
  capabilityOverrides?: Partial<Record<WorkflowStage, CanonicalCapability[]>>,
): DAGError[]
```

### 3.4 Validation algorithm

1. **Stage validation**: All stages in `dag.stages` must be valid `WorkflowStage` values
2. **Self-loop check**: No edge where `from === to`
3. **Edge coverage**: All edge endpoints must be in `dag.stages`
4. **Entry detection**: Exactly one node with in-degree 0
5. **Cycle detection**: Kahn's algorithm — remove nodes with in-degree 0 iteratively; remaining nodes form cycles
6. **Reachability**: BFS from entry; unreached nodes reported
7. **Capability coverage**: For each stage, at least one role must have a matching capability (from override or default)

### 3.5 Runtime integration

```typescript
// team/dag/helpers.ts
export function getNextStage(
  current: WorkflowStage,
  dag: WorkflowDAG,
): WorkflowStage | null {
  const edge = dag.edges.find(e => e.from === current)
  return edge?.to ?? null
}

export function generateDefaultDAG(): WorkflowDAG {
  const stages: WorkflowStage[] = ["plan", "challenge", "contract", "build", "review", "ship", "retro"]
  const edges: WorkflowDAGEdge[] = []
  for (let i = 0; i < stages.length - 1; i++) {
    edges.push({ from: stages[i], to: stages[i + 1] })
  }
  return { stages, edges }
}
```

### 3.6 Config integration

```typescript
// team/config.ts — EDIT
import { DAGOverride } from "./dag"

export const CanonicalTeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), CanonicalTeamRole),
  routing: CanonicalTeamRouting,
  reactions: z.array(ReactionRule).default([]).optional(),
  workflowOverride: DAGOverride.optional(), // NEW
})
// ... existing refines ...
.superRefine((cfg, ctx) => {
  // NEW: If workflowOverride present, validate DAG against roles
  if (cfg.workflowOverride) {
    const roleCapabilities = new Map<CanonicalCapability, boolean>()
    for (const role of Object.values(cfg.roles)) {
      for (const cap of role.capabilities) {
        roleCapabilities.set(cap, true)
      }
    }
    const errors = validateDAG(
      cfg.workflowOverride.dag,
      roleCapabilities,
      cfg.workflowOverride.capabilityOverrides,
    )
    for (const err of errors) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: formatDAGError(err),
        path: ["workflowOverride"],
      })
    }
  }
})
```

### 3.7 Version migration

```typescript
// team/versioning.ts — EDIT
export const CURRENT_TEAM_CONFIG_VERSION = "1.1.0"

export const TeamConfigVersion = z.enum(["1.0.0", "1.1.0"])

// Migration registry
const migrations: Record<string, (raw: unknown) => unknown> = {
  "1.0.0": (raw) => raw, // Identity — 1.0.0 → 1.1.0 is additive
}

export async function migrateTeamConfig(raw: unknown): Promise<CanonicalTeamConfig> {
  // ... existing legacy detection ...
  
  // Version chain migration
  let version = detectVersion(raw) ?? "1.0.0"
  let data = raw
  while (version !== CURRENT_TEAM_CONFIG_VERSION) {
    const migrate = migrations[version]
    if (!migrate) throw new Error(`No migration from ${version}`)
    data = migrate(data)
    version = nextVersion(version)
  }
  
  return CanonicalTeamConfig.parse(data)
}
```

---

## 4. File Touch List

| File | Type | Est. LOC | Purpose |
|---|---|---|---|
| `team/dag/schema.ts` | NEW | 35 | WorkflowDAG, DAGEdge, DAGOverride schemas |
| `team/dag/validator.ts` | NEW | 120 | validateDAG(), DAGError types, Kahn's algorithm |
| `team/dag/helpers.ts` | NEW | 50 | getNextStage(), getEntryStage(), generateDefaultDAG() |
| `team/dag/index.ts` | NEW | 15 | Barrel exports |
| `team/config.ts` | EDIT | +25 | Add workflowOverride field + DAG superRefine |
| `team/versioning.ts` | EDIT | +30 | Bump to 1.1.0, migration registry |
| `team/index.ts` | EDIT | +5 | Re-export dag/ |
| `devil-ui/primitives/dag-editor/index.tsx` | NEW | 80 | DAGEditor component |
| `devil-ui/primitives/dag-editor/types.ts` | NEW | 15 | Props interface |
| `devil-ui/primitives/index.ts` | EDIT | +2 | Export dag-editor |
| `devil-ui/package.json` | EDIT | +1 | Add exports entry |
| `workflow-tui/views/team-builder-context.tsx` | EDIT | +20 | DAG draft state |
| `workflow-tui/views/team-builder.tsx` | EDIT | +40 | Workflow tab + DAGEditor |
| `test/devilcode/team/dag/schema.test.ts` | NEW | 40 | Schema validation |
| `test/devilcode/team/dag/validator.test.ts` | NEW | 100 | Cycle/reachability/capability tests |
| `test/devilcode/team/dag/helpers.test.ts` | NEW | 30 | Helper function tests |
| `test/devilcode/team/dag/integration.test.ts` | NEW | 80 | 3 synthetic DAG integration tests |
| **Totals** | | **~600** | Source ~350 · Tests ~250 |

---

## 5. Wave & Plan Breakdown

### Plan 07-01 (Wave 1): DAG Module + Schema Integration
Deps: Phase 6 complete. 3 tasks:

- **Task 1 — Schema + Validator**:
  - NEW: `team/dag/schema.ts`, `team/dag/validator.ts`
  - Kahn's algorithm implementation
  - All DAGError types
  - NEW tests: `schema.test.ts`, `validator.test.ts`
  - Verification: tests pass; `bun turbo typecheck` clean

- **Task 2 — Helpers + Config Integration**:
  - NEW: `team/dag/helpers.ts`, `team/dag/index.ts`
  - EDIT: `team/config.ts` — add `workflowOverride` field + DAG superRefine
  - EDIT: `team/index.ts` — barrel export
  - NEW tests: `helpers.test.ts`
  - Verification: existing team tests still pass; new tests pass

- **Task 3 — Versioning + Integration Tests**:
  - EDIT: `team/versioning.ts` — bump to 1.1.0, migration registry
  - NEW: `integration.test.ts` — 3 synthetic non-default DAGs
  - Verification: round-trip export/import with DAG override works; version bump reflected

### Plan 07-02 (Wave 2): UI + Runtime Integration
Deps: Plan 07-01 complete. 3 tasks:

- **Task 1 — devil-ui DAGEditor Primitive**:
  - NEW: `devil-ui/primitives/dag-editor/index.tsx`, `types.ts`
  - EDIT: `devil-ui/primitives/index.ts`, `devil-ui/package.json`
  - Storybook story
  - Verification: storybook renders; typecheck clean

- **Task 2 — Team Builder Integration**:
  - EDIT: `team-builder-context.tsx` — add DAG draft state
  - EDIT: `team-builder.tsx` — add Workflow tab
  - Advanced mode toggle
  - Verification: DAG editor renders in team-builder; validation errors surface

- **Task 3 — Runtime Dispatch + Final Tests**:
  - EDIT: `orchestrator.ts` or `workflow/` — use `getNextStage()` for custom DAGs
  - Verify all 3 synthetic DAGs execute correctly
  - All CI gates pass
  - Verification: `bun turbo typecheck`, `bun run knip`, `bun run format:check`

---

## 6. Testing Strategy

### Unit tests

| Module | Test file | Cases |
|---|---|---|
| schema.ts | schema.test.ts | Valid DAG parses; invalid stage rejected; empty edges defaults; edge condition optional |
| validator.ts | validator.test.ts | Self-loop detected; cycle detected (2-node, 3-node); no-entry rejected; multiple-entries rejected; unreachable stages reported; capability coverage validated |
| helpers.ts | helpers.test.ts | getNextStage returns correct successor; returns null at terminal; generateDefaultDAG produces 7 stages + 6 edges |

### Integration tests

3 synthetic non-default DAGs:

1. **Skip-challenge DAG**: `plan → contract → build → review → ship → retro` (6 stages, removes challenge)
2. **Minimal DAG**: `plan → build → ship` (3 stages only)
3. **Reordered DAG**: `plan → research → build → review → ship` (custom stage order with capability override for "research" mapping to `retro` stage with retrospective capability)

Each test:
- Constructs DAG programmatically
- Validates via `validateDAG()`
- Exports to JSON envelope
- Re-imports and validates round-trip
- Confirms `getNextStage()` traversal matches expected sequence

### Malformed DAG fixtures

| Case | Expected error |
|---|---|
| `edges: [{ from: "plan", to: "plan" }]` | `{ kind: "self-loop", stage: "plan" }` |
| `stages: ["plan", "build"], edges: [{ from: "build", to: "plan" }]` | `{ kind: "cycle", nodes: ["plan", "build"] }` |
| `stages: ["plan", "build", "orphan"], edges: [{ from: "plan", to: "build" }]` | `{ kind: "unreachable", stages: ["orphan"] }` |
| `stages: [], edges: []` | Zod rejection (nonempty stages) |
| `stages: ["plan", "build"], edges: []` | `{ kind: "no-entry" }` if entries > 1 OR reachability failure |

---

## 7. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| DAG validation overhead on every config load | LOW | Kahn's algorithm is O(V+E) for ~10 nodes = sub-ms; lazy validation on save, not load |
| Custom DAG breaks existing workflow state mid-run | MEDIUM | DAG changes only take effect on NEW workflow start, not mid-run; state machine continues with old config |
| UI complexity for non-technical users | MEDIUM | Hidden by default under "Advanced mode"; default 7-stage DAG shown as read-only preview |
| Capability override creates uncovered stages | LOW | `validateDAG()` reports `missing-capability` error before save; blocked from starting workflow |
| Edge condition field unused | LOW | Schema supports it; runtime ignores; documented as "reserved for Phase 9+" |
| Version migration chain complexity | MEDIUM | Only 1.0.0 → 1.1.0 in Phase 7; identity migration; tested explicitly |

---

## 8. Open Questions

All resolved in research phase.

- **OQ-1** — Should edges be required or auto-generated from stage order? **Resolved**: Auto-generate default edges when `edges` array is empty.
- **OQ-2** — Multiple exit nodes allowed? **Resolved**: Yes, but exactly one entry required. Exit = node with out-degree 0.
- **OQ-3** — DAG editor visual library? **Resolved**: CSS-based layout for v1; no external library.

---

## 9. Acceptance Criteria

- [ ] `CanonicalTeamConfig` supports optional `workflowOverride: { dag, capabilityOverrides? }` (ROADMAP criterion 1)
- [ ] DAG validator rejects cycles, unreachable stages, missing capabilities with specific error types (ROADMAP criterion 2)
- [ ] Team-builder surfaces DAG editor in Workflow tab (advanced mode, hidden by default) (ROADMAP criterion 3)
- [ ] Runtime dispatch uses override when present; falls back to default 7-stage DAG (ROADMAP criterion 4)
- [ ] At least 3 synthetic non-default DAGs pass integration tests (ROADMAP criterion 5)
- [ ] Version bumped to 1.1.0; migration from 1.0.0 works transparently
- [ ] `bun turbo typecheck` clean
- [ ] All Phase 6 tests still pass (regression gate)
- [ ] devil-ui dag-editor renders in Storybook

---

## 10. Assessment

### Critique checkpoint

**CRITICAL — addressed in spec**:
1. **Kahn's algorithm correctness**: Pseudocode provided; returns remaining nodes as cycle members
2. **Entry stage uniqueness**: Explicit validation rule + error type
3. **Capability override fallback**: Clear semantics — override takes precedence, then default mapping

**HIGH — addressed**:
4. **Version migration chain**: Explicit registry pattern; 1.0.0 → 1.1.0 is identity
5. **UI state management**: DAG draft in team-builder-context, not global state

**MEDIUM — noted**:
6. **Conditional edges deferred**: Schema supports; runtime ignores; documented
7. **Visual DAG library deferred**: CSS layout for v1; acceptable for 7 nodes

### Verdict: PASS

**Complexity**: Medium.
- New module (`team/dag/`) with 4 files
- devil-ui primitive (1 component)
- Config + versioning edits
- Not "Simple" because DAG validation has algorithmic complexity
- Not "Complex" because no external dependencies, no new cross-package edges

**Plan count**: 2, matching ROADMAP.
- Wave 1: Pure DAG module + schema integration
- Wave 2: UI + runtime integration

**Recommended agents**:
- Wave 1: Backend Architect (DAG schema, validator algorithm), Senior Developer (implementation)
- Wave 2: Frontend Developer (devil-ui primitive, team-builder UI), Senior Developer (runtime integration)
- Reviewer: QA Verification Specialist (DAG validation coverage, integration tests)

**Confidence**: HIGH.
- Clear precedent from Phase 6 (versioning pipeline, schema extension)
- Kahn's algorithm is well-documented, simple to implement
- devil-ui primitive pattern established in Phase 5

---

*End of Spec — Phase 7 Configurable Workflow DAG*
