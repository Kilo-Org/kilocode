# Phase 10: Live Team Editing & Final Polish — Context

## Phase Goal

Enable hot-swapping team positions mid-workflow without aborting execution. In-flight tasks complete on old agent; new tasks route to swapped agent. Ship user guide and migration guide.

## Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| R10-1 | `/team swap <position> <provider> <model>` command | MUST |
| R10-2 | In-flight task finishes on old agent | MUST |
| R10-3 | Concurrency slots rebalance on swap | MUST |
| R10-4 | Chaos tests (swap mid-wave, during review, during challenge) | MUST |
| R10-5 | User guide at devil-docs | MUST |
| R10-6 | Migration guide for old workflow-tui users | MUST |
| R10-7 | All CI checks green | MUST |

## Existing Assets

### From Phase 9
- `TeamBuilderHandler` in VS Code extension (CRUD + aggregations)
- `team-builder-types.ts` message contracts
- HTTP routes: GET/PUT/DELETE `/config/team`

### From Phase 8
- Command handler DI pattern (`registerTeamRegistryCommands`)
- Event logging infrastructure

### From Phase 6
- Team persistence layer (`LayeredTeamRepository`)
- Export/import envelope with checksum

### From Phase 5
- Runtime cockpit with density toggle
- OnboardingWizard integration

## Architecture Decision

**Selected: Clean** (vs Minimal / Pragmatic)

Rationale: Matches Phases 3-9 precedent; user prioritizes Phase 11+ zero-rework.

Key elements:
1. New `team/position-swap.ts` module for swap validation + application
2. New `workflow/position-swap-events.ts` for swap lifecycle events
3. Transactional slot rebalancing in concurrency manager
4. Single HTTP endpoint `POST /devilcode/workflow/team/swap`
5. In-flight task continuity (no mid-task migration)

## Plan Structure

| Plan | Wave | Primary Agents | Focus |
|------|------|----------------|-------|
| 10-01 | 1 | Backend Architect, Senior Developer | Core swap infrastructure |
| 10-02 | 2 | Senior Developer, Technical Writer | TUI/Extension + docs |

## Dependencies

- Phase 9 must be complete (TeamBuilderHandler exists)
- No external dependencies

## Key Decisions

| Decision | Rationale |
|----------|-----------|
| Swap persists to team config | User expects swap to survive CLI restart |
| Tier changes forbidden during swap | Tier affects hierarchy; must edit in team builder |
| No active task preemption | Preemption is unsafe (partial output, file locks) |
| Validation is advisory | Fail gracefully at Session.create; don't block swap |

## Spec Reference

`.planning/specs/10-live-team-editing-spec.md`
