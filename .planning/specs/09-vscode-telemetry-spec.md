# Spec: Phase 9 — VS Code Extension UI & Telemetry Dashboards

## Overview

Port the TUI team-builder into VS Code's Agent Manager webview as a new "Team Builder" tab, achieving feature parity with the existing terminal-based builder. Add telemetry dashboards that visualize workflow performance metrics (success rate, stall rate, cost, duration) computed server-side from the existing `.planning/events.jsonl` event log. All team types import from `@devilcode/sdk` — no schema duplication.

This phase completes the Team Orchestrator's cross-platform story: teams built in VS Code persist to the same backend, use the same validation, and integrate with the same workflow runtime as the TUI.

## Requirements

| ID | Description | Priority | Acceptance Criteria |
|----|-------------|----------|-------------------|
| P9-01 | Team Builder tab in Agent Manager | Must | Tab renders position picker, roster table, stage coverage indicator; matches TUI feature set |
| P9-02 | Team persistence via KiloConnectionService | Must | Save/load teams round-trip through CLI backend; verify with manual edit in both UIs |
| P9-03 | Success rate dashboard | Must | Chart shows completed/started ratio per team; updates on refresh |
| P9-04 | Stall rate dashboard | Must | Chart shows max wait time per position; highlights bottlenecks |
| P9-05 | Cost per workflow dashboard | Should | Chart shows cumulative cost per workflow run if `metadata.cost` present in events; shows "Cost data unavailable" otherwise |
| P9-06 | Duration by stage dashboard | Must | Chart shows time distribution across 7 stages |
| P9-07 | Aggregation endpoint | Must | `/devilcode/workflow/aggregations` returns pre-computed metrics JSON |
| P9-08 | SDK type exports | Must | Team types exported from @devilcode/sdk; webview imports without CLI dep |
| P9-09 | CI compliance | Must | Knip passes, format check passes, no devilcode_change markers needed |

## Architecture

The extension follows the established Agent Manager pattern: webview components render UI, message contracts define type-safe communication, and the extension backend handles CLI interaction via KiloConnectionService.

```
┌─────────────────────────────────────────────────────────────────┐
│ VS Code Extension (Node.js)                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ AgentManagerProvider.handleMessage()                         ││
│  │   ├─ teamBuilder.loadTeam → connectionService.getTeam()      ││
│  │   ├─ teamBuilder.saveTeam → connectionService.updateTeam()   ││
│  │   └─ teamBuilder.getAggregations → HTTP /workflow/aggregations││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
              │ postMessage() │ onMessage()
              ▼               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Webview (SolidJS + devil-ui DOM branch)                         │
│  ┌──────────────────┐  ┌────────────────────────────────────────┐│
│  │ TeamBuilderTab   │  │ TelemetryDashboards                    ││
│  │  - RosterTable   │  │  - SuccessRateChart                    ││
│  │  - PositionPicker│  │  - StallRateChart                      ││
│  │  - StageCoverage │  │  - CostChart                           ││
│  │  - DAGEditor     │  │  - DurationChart                       ││
│  └──────────────────┘  └────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
              │ HTTP
              ▼
┌─────────────────────────────────────────────────────────────────┐
│ CLI Backend (Hono)                                              │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ /devilcode/workflow/aggregations                            ││
│  │   - Reads .planning/events.jsonl via EventLogger            ││
│  │   - Computes: successRate, stallRate, costTotal, durations  ││
│  │   - Returns AggregationResponse JSON                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Key Decisions

| Decision | Choice | Rationale | Alternatives Considered |
|----------|--------|-----------|----------------------|
| Team Builder location | New tab in Agent Manager | Reuses existing webview infrastructure; consistent UI surface | Separate panel (rejected: more complexity, split attention) |
| State management | Local SolidJS store + message sync | Matches existing Agent Manager pattern; optimistic UI | Direct HTTP calls (rejected: no local state for optimistic updates) |
| Aggregation location | Server-side endpoint | Scales with event log size; no client-side file access | Client-side (rejected: large event files, N+1 parsing) |
| Chart rendering | Plain SVG + CSS | Zero dependency; small bundle; sufficient for 4 charts | d3 (rejected: overkill), recharts (rejected: bundle size) |
| devil-ui reuse | Import StageCoverageIndicator, TabGroup | DOM branches exist; avoids duplication | Copy components (rejected: maintenance burden) |
| Type sharing | Export from @devilcode/sdk | Single source of truth; webview has no CLI import | Duplicate types (rejected: drift risk) |

## Deliverables

### 1. Team CRUD Routes

- **Path:** `packages/opencode/src/server/routes/config.ts` (extend existing)
- **Purpose:** HTTP endpoints for team configuration CRUD
- **Key Content:**
  - `GET /config/team/:id` — load team by ID from LayeredTeamRepository
  - `PUT /config/team/:id` — save/update team config
  - `DELETE /config/team/:id` — remove user team (cannot delete quickstarts)
  - `GET /config/team` — list all teams (user + quickstarts)
- **Dependencies:** LayeredTeamRepository, CanonicalTeamConfig
- **Estimated Size:** ~120 LOC additions

### 2. Aggregation Endpoint

- **Path:** `packages/opencode/src/devilcode/workflow/aggregations.ts`
- **Purpose:** Server-side computation of workflow telemetry metrics
- **Key Content:**
  ```typescript
  interface AggregationResponse {
    successRateByTeam: Record<string, { completed: number; started: number; rate: number }>
    stallRateByPosition: Record<string, { maxWaitMs: number; avgWaitMs: number }>
    costByWorkflow: { workflowId: string; totalCost: number }[]
    durationByStage: Record<WorkflowStage, { avgMs: number; p95Ms: number; count: number }>
    generatedAt: string
  }
  ```
- **Dependencies:** EventLogger.readAll(), WorkflowStage enum
- **Estimated Size:** ~150 LOC

### 3. DevilConnectionService Team Methods

- **Path:** `packages/devil-vscode/src/services/cli-backend/connection-service.ts`
- **Purpose:** Extension-side HTTP client methods for team CRUD
- **Key Content:**
  - `getTeam(id: string): Promise<CanonicalTeamConfig>`
  - `listTeams(): Promise<TeamHandle[]>`
  - `saveTeam(id: string, config: CanonicalTeamConfig): Promise<void>`
  - `deleteTeam(id: string): Promise<void>`
  - `getAggregations(): Promise<AggregationResponse>`
- **Dependencies:** Team CRUD routes
- **Estimated Size:** ~80 LOC additions

### 4. Message Contract Extensions

- **Path:** `packages/devil-vscode/src/agent-manager/types.ts`
- **Purpose:** Type-safe message definitions for team builder communication
- **Key Content:**
  - `TeamBuilderLoadTeamIn` / `TeamBuilderTeamLoadedOut`
  - `TeamBuilderSaveTeamIn` / `TeamBuilderTeamSavedOut`
  - `TeamBuilderGetAggregationsIn` / `TeamBuilderAggregationsOut`
  - `TeamBuilderValidateIn` / `TeamBuilderValidationResultOut`
- **Dependencies:** CanonicalTeamConfig from @devilcode/sdk
- **Estimated Size:** ~100 LOC additions

### 5. Extension Message Handlers

- **Path:** `packages/devil-vscode/src/agent-manager/team-builder-handler.ts`
- **Purpose:** Isolated handler class for team builder messages (avoids bloating AgentManagerProvider)
- **Key Content:**
  - `handleTeamBuilderMessage(msg)` dispatcher
  - `loadTeam()` → KiloConnectionService → CLI
  - `saveTeam()` → KiloConnectionService → CLI
  - `getAggregations()` → HTTP fetch → aggregations endpoint
- **Dependencies:** KiloConnectionService, message types
- **Estimated Size:** ~200 LOC

### 6. Team Builder Tab (Webview)

- **Path:** `packages/devil-vscode/webview-ui/agent-manager/TeamBuilderTab.tsx`
- **Purpose:** Main container for team building UI in Agent Manager
- **Key Content:**
  - State store mirroring TeamBuilderState (position list, draft config, validation)
  - PositionPicker modal (reuses position data from SDK)
  - RosterTable (inline editing for provider/model/effort)
  - StageCoverageIndicator (imported from devil-ui)
  - Save/Load actions via postMessage
- **Dependencies:** devil-ui primitives, message handlers
- **Estimated Size:** ~400 LOC

### 7. Dashboard Container

- **Path:** `packages/devil-vscode/webview-ui/agent-manager/dashboards/`
- **Purpose:** Telemetry visualization components
- **Key Content:**
  - `index.tsx` — container with 4 dashboard slots
  - `SuccessRateChart.tsx` — bar chart per team
  - `StallRateChart.tsx` — position bottleneck indicator
  - `CostChart.tsx` — cumulative cost line
  - `DurationChart.tsx` — stage distribution bars
- **Dependencies:** AggregationResponse type, SVG rendering utilities
- **Estimated Size:** ~350 LOC (4 files)

### 8. SDK Type Exports

- **Path:** `packages/sdk/js/src/team.ts`
- **Purpose:** Re-export team types for external consumers
- **Key Content:**
  ```typescript
  export type { CanonicalTeamConfig, CanonicalTeamRole, CanonicalPosition }
  export type { WorkflowDAG, DAGOverride }
  export type { QuickstartTemplate, QuickstartId }
  ```
- **Dependencies:** Generated from CLI types via SDK generator
- **Estimated Size:** ~30 LOC

### 9. Integration Wiring

- **Path:** `packages/devil-vscode/src/agent-manager/AgentManagerProvider.ts`
- **Purpose:** Wire TeamBuilderHandler into existing message dispatch
- **Key Content:**
  - Import TeamBuilderHandler
  - Add `teamBuilder.*` message prefix routing to handler
  - No other changes to existing handler logic
- **Dependencies:** TeamBuilderHandler
- **Estimated Size:** ~20 LOC additions

## Open Questions

| # | Question | Impact | Default if Unresolved |
|---|----------|--------|---------------------|
| 1 | Cost metadata field name in events | Deferrable | Use `metadata.cost` if present; show "N/A" if absent |
| 2 | Dashboard refresh interval | Deferrable | Manual refresh button; no auto-polling in v1 |
| 3 | Team validation errors display | Deferrable | Toast notification matching TUI pattern |
| 4 | DAG editor in webview | Deferrable | Display-only in v1 (matches TUI); editing deferred |

## Complexity Assessment

**Rating:** Medium-Complex

| Metric | Value |
|--------|-------|
| Requirements | 9 |
| Deliverables | 9 (new: 6, modify: 3, config: 0) |
| Estimated waves | 3 |
| Estimated plans | 3 |
| Competing proposals | Already completed (Clean selected) |

**Rationale:** Multi-package coordination (opencode + devil-vscode + sdk), new HTTP endpoint, webview state management, and 4 dashboard components. Clean architecture requires proper message contracts and handler isolation.

**Recommended next step:** Run `/legion:plan 9` to decompose into executable plans. No additional architecture proposals needed (Clean already selected).

## Revision History

| # | Section | Change | Reason |
|---|---------|--------|--------|
| 1 | Initial | Created from gather + research stages | Phase 9 planning |
| 2 | P9-05 | Added "if metadata.cost present" qualifier | Critique: cost data source unverified |
| 3 | Deliverables | Added Team CRUD Routes (new #1) | Critique: no existing team HTTP endpoints |
| 4 | Deliverables | Added DevilConnectionService Team Methods (new #3) | Critique: KiloConnectionService lacks team methods |
| 5 | Deliverable count | Updated 7 → 9 | Scope expansion from critique |
