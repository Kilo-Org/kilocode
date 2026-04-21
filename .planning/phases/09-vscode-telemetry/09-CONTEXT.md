# Phase 9 Context — VS Code Extension UI & Telemetry Dashboards

## Phase Goal

Port the TUI team-builder into VS Code's Agent Manager webview as a new "Team Builder" tab, achieving feature parity with the existing terminal-based builder. Add telemetry dashboards that visualize workflow performance metrics (success rate, stall rate, cost, duration) computed server-side from the existing `.planning/events.jsonl` event log.

## Requirements

| ID | Description | Priority |
|----|-------------|----------|
| P9-01 | Team Builder tab in Agent Manager with feature parity to TUI | Must |
| P9-02 | Team persistence via KiloConnectionService to CLI | Must |
| P9-03 | Success rate dashboard (completed/started per team) | Must |
| P9-04 | Stall rate dashboard (max wait per position) | Must |
| P9-05 | Cost per workflow dashboard (if metadata.cost present) | Should |
| P9-06 | Duration by stage dashboard (7-stage distribution) | Must |
| P9-07 | Aggregation endpoint at `/devilcode/workflow/aggregations` | Must |
| P9-08 | SDK type exports (no schema duplication) | Must |
| P9-09 | CI compliance (knip, format, no devilcode_change markers) | Must |

## Existing Assets

### CLI Team Module (`packages/opencode/src/devilcode/team/`)
- `config.ts`: CanonicalTeamConfig, CanonicalTeamRole Zod schemas
- `library.ts`: POSITION_LIBRARY with 11 canonical positions
- `capabilities.ts`: STAGE_CAPABILITY_REQUIREMENTS for 7 stages
- `repository.ts`: TeamRepository interface + createFileSystemTeamRepository
- `layered-repository.ts`: createLayeredTeamRepository (user + project + quickstart)
- `quickstarts.ts`: loadQuickstartTemplates(), 5 bundled team templates

### CLI Workflow Module (`packages/opencode/src/devilcode/workflow/`)
- `events.ts`: EventLogger class, WorkflowEvent type, .planning/events.jsonl storage
- `routes.ts`: Existing endpoints `/status`, `/plans`, `/events`
- `types.ts`: WorkflowStage enum (plan|challenge|contract|build|review|ship|retro)

### VS Code Extension (`packages/devil-vscode/`)
- `src/agent-manager/AgentManagerProvider.ts`: Webview provider, handleMessage() dispatch
- `src/agent-manager/types.ts`: AgentManagerInMessage/OutMessage discriminated unions
- `src/services/cli-backend/connection-service.ts`: DevilConnectionService (HTTP client)
- `webview-ui/agent-manager/AgentManagerApp.tsx`: Main webview entry point

### devil-ui Primitives (`packages/devil-ui/src/primitives/`)
- `stage-coverage-indicator/`: DOM branch ready, shows 7-stage coverage
- `tab-group/`: Keyboard-navigable tabs with render-prop pattern
- `dag-editor/`: Display-only DAG visualization

### Existing Config Routes (`packages/opencode/src/server/routes/config.ts`)
- `/config/team/presets`: GET returns quickstart templates
- `/config/team/validate`: POST validates team config (not yet implemented)

## Architecture Decision

**Selected: Clean** (2026-04-21)

Per prior phases precedent, Clean architecture prioritizes:
- Server-side aggregation (no client-side file parsing)
- devil-ui component reuse (StageCoverageIndicator, TabGroup)
- Type-safe message contracts (discriminated unions)
- Isolated handlers (TeamBuilderHandler class)
- SDK type exports (single source of truth)

## Plan Structure

| Plan | Wave | Focus | Primary Agent | Deps |
|------|------|-------|---------------|------|
| 09-01 | 1 | CLI Backend Foundation | Backend Architect | Phase 8 |
| 09-02 | 2 | Extension Layer | Senior Developer | 09-01 |
| 09-03 | 3 | Webview UI | Frontend Developer | 09-02 |

## Success Criteria

1. Tab renders position picker, roster table, stage coverage indicator
2. Save/load teams round-trip through CLI backend
3. Dashboards render 4 metric types from aggregation endpoint
4. Extension imports types from @devilcode/sdk (no duplication)
5. All CI checks pass (knip, format, typecheck)

## Spec Reference

Full specification: `.planning/specs/09-vscode-telemetry-spec.md`
