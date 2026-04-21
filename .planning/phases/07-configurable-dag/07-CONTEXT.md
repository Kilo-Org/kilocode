# Phase 7 Context — Configurable Workflow DAG

## Phase Goal
Allow users to reorder workflow stages and override the stage → capability mapping per team. Enforce DAG integrity with cycle detection and capability coverage validation. Surface DAG configuration in the team-builder UI (advanced mode).

## Architecture Decision
**Clean** architecture selected (2026-04-21):
- New `team/dag/` module with explicit edge representation
- Full validator with rich error types
- devil-ui `dag-editor` primitive (reusable for Phase 9)
- Version bump to 1.1.0

## Requirements Coverage
| Requirement | Plan |
|---|---|
| TeamConfig supports workflowOverride | 07-01 Task 2 |
| DAG validator (cycles, reachability, capabilities) | 07-01 Task 1 |
| Team-builder DAG editor (advanced mode) | 07-02 Task 2 |
| Runtime dispatch uses override | 07-02 Task 3 |
| 3 synthetic non-default DAG tests | 07-01 Task 3 |

## Prior Phase Outputs
- Phase 6: `team/versioning.ts` (CURRENT_TEAM_CONFIG_VERSION = "1.0.0"), `team/io.ts`, `LayeredTeamRepository`
- Phase 5: devil-ui primitives pattern (`primitives/`), TabGroup, DensityProvider
- Phase 4: `team-builder-context.tsx`, TeamBuilderProvider state machine

## Key Decisions
| Decision | Rationale |
|---|---|
| Explicit edges `{ from, to }` | Supports non-linear DAGs, clear validation errors |
| Kahn's algorithm | O(V+E), simple, returns cycle participants |
| Exactly one entry stage | Runtime doesn't support parallel execution |
| Version 1.1.0 (not 2.0.0) | Additive change, backward compatible |
| capabilityOverrides is optional | Default falls back to STAGE_CAPABILITY_REQUIREMENTS |

## Spec Reference
`.planning/specs/07-configurable-dag-spec.md`

## Plan Structure
| Plan | Wave | Deps | Primary Agents |
|---|---|---|---|
| 07-01 DAG Module + Schema Integration | 1 | Phase 6 | Backend Architect, Senior Developer |
| 07-02 UI + Runtime Integration | 2 | 07-01 | Frontend Developer, Senior Developer |

---
*Generated: 2026-04-21*
