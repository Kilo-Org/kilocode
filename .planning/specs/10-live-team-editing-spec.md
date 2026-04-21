# Phase 10: Live Team Editing & Final Polish — Specification

**Complexity**: Medium-Complex
**Confidence**: HIGH
**Architecture**: Clean (selected from Minimal/Clean/Pragmatic proposals)

## Overview

Phase 10 enables hot-swapping team positions mid-workflow without aborting execution. In-flight tasks complete on the old agent; new tasks route to the swapped agent. Includes concurrency slot rebalancing, chaos tests, user guide, and migration guide.

## Requirements Mapping

| Requirement | Source | Priority |
|-------------|--------|----------|
| `/team swap <position> <provider> <model>` command | ROADMAP.md | MUST |
| In-flight task finishes on old agent | ROADMAP.md | MUST |
| Concurrency slots rebalance on swap | ROADMAP.md | MUST |
| Chaos tests (swap mid-wave, during review, during challenge) | ROADMAP.md | MUST |
| User guide at `devil-docs/pages/collaborate/teams/team-orchestrator-guide.md` | ROADMAP.md | MUST |
| Migration guide for old workflow-tui users | ROADMAP.md | MUST |
| All CI checks green | ROADMAP.md | MUST |

## Architecture Decision

**Selected: Clean** — matches Phases 3-9 precedent; user prioritizes Phase 11+ zero-rework.

Key architectural elements:
1. **New module `team/position-swap.ts`**: Single-purpose swap validation + application logic
2. **New module `workflow/position-swap-events.ts`**: Event emission for swap lifecycle
3. **Transactional slot rebalancing**: Acquire new slots → apply swap → release old slots
4. **Single HTTP endpoint**: `POST /devilcode/workflow/team/swap` unifies CLI and extension
5. **In-flight task continuity**: Active sessions continue on old agent (no mid-task migration)

## Module Specifications

### 1. `packages/opencode/src/devilcode/team/position-swap.ts`

```typescript
// Zod schemas
export const PositionSwapRequest = z.object({
  position: z.string(), // role name (e.g., "senior-developer")
  provider: z.string(), // new provider ID
  model: z.string(),    // new model ID
})

export const PositionSwapResult = z.discriminatedUnion("success", [
  z.object({
    success: z.literal(true),
    position: z.string(),
    previousProvider: z.string(),
    previousModel: z.string(),
    newProvider: z.string(),
    newModel: z.string(),
    slotsRebalanced: z.number(),
  }),
  z.object({
    success: z.literal(false),
    error: z.string(),
    code: z.enum(["POSITION_NOT_FOUND", "INVALID_PROVIDER", "INVALID_MODEL", "DELEGATION_VIOLATION", "WORKFLOW_NOT_ACTIVE"]),
  }),
])

// Core functions
export function validatePositionSwap(
  teamConfig: CanonicalTeamConfig,
  request: PositionSwapRequest,
): { valid: true } | { valid: false; error: string; code: string }

export function applyPositionSwap(
  teamConfig: CanonicalTeamConfig,
  request: PositionSwapRequest,
): PositionSwapResult

export function rebalanceConcurrencySlots(
  role: string,
  oldMaxConcurrent: number,
  newMaxConcurrent: number,
  concurrencyManager: ConcurrencyManager,
): { freed: number; queued: number }
```

### 2. `packages/opencode/src/devilcode/workflow/position-swap-events.ts`

```typescript
export const PositionSwapValidating = BusEvent.define(
  "position-swap:validating",
  z.object({ position: z.string(), newProvider: z.string(), newModel: z.string() })
)

export const PositionSwapSuccess = BusEvent.define(
  "position-swap:success",
  PositionSwapResult.options[0] // success branch
)

export const PositionSwapFailed = BusEvent.define(
  "position-swap:failed",
  PositionSwapResult.options[1] // failure branch
)

export const PositionSwapRebalance = BusEvent.define(
  "position-swap:rebalance",
  z.object({ role: z.string(), freed: z.number(), queued: z.number() })
)
```

### 3. HTTP Route: `POST /devilcode/workflow/team/swap`

**Location**: `packages/opencode/src/devilcode/workflow/routes.ts`

```typescript
// Request body
{ position: string, provider: string, model: string }

// Response
{ success: boolean, ...PositionSwapResult fields }
```

**Behavior**:
1. Parse and validate request body against PositionSwapRequest
2. Get current workflow state via Instance.state
3. If no active workflow: return error `WORKFLOW_NOT_ACTIVE`
4. Call validatePositionSwap() — check position exists, provider/model valid, delegation hierarchy
5. Emit PositionSwapValidating event
6. Call applyPositionSwap() — update teamConfig.roles[position].provider/.model
7. Call rebalanceConcurrencySlots() if maxConcurrent changed
8. Emit PositionSwapSuccess or PositionSwapFailed
9. Return result

### 4. TUI Command: `/team swap <position> <provider> <model>`

**Location**: `packages/opencode/src/devilcode/workflow-tui/commands/team-swap.ts`

```typescript
export const swapCommand: Command = {
  id: "team-swap",
  name: "team swap",
  description: "Swap a team position's provider/model mid-workflow",
  aliases: ["swap"],
  keybind: undefined,
  hidden: false,
  enabled: (ctx) => ctx.workflowActive,
  action: async (ctx, args) => {
    // Parse: "senior-developer anthropic claude-sonnet-4-20250514"
    const [position, provider, model] = args.split(/\s+/)
    if (!position || !provider || !model) {
      return { error: "Usage: team swap <position> <provider> <model>" }
    }
    // Call HTTP endpoint or direct function
    const result = await ctx.swapPosition(position, provider, model)
    return result
  },
}
```

**Registration**: Add to `registerTeamCommands()` in `workflow-tui/commands/team-commands.ts`

### 5. VS Code Extension Integration

**Message type** (`src/messages/team-builder-types.ts`):
```typescript
export type TeamBuilderSwapMessage = {
  type: "teamBuilder.swapPosition"
  position: string
  provider: string
  model: string
}

export type TeamBuilderSwappedMessage = {
  type: "teamBuilder.swapped"
  position: string
  success: boolean
  newProvider?: string
  newModel?: string
  error?: string
}
```

**Handler** (`src/agent-manager/team-builder-handler.ts`):
```typescript
case "teamBuilder.swapPosition":
  await this.handleSwapPosition(tbMsg.position, tbMsg.provider, tbMsg.model)
  return true
```

### 6. BuildRunner Integration

**Location**: `packages/opencode/src/devilcode/workflow/build-runner.ts`

No changes to BuildRunner core logic. The swap is applied to `teamConfig.roles[position]` in-place. BuildRunner already reads from `this.options.teamConfig` for each task dispatch via `resolveTaskModel()`.

Key invariant: In-flight tasks have already resolved their model at `Session.create()` time. Swapping the config does NOT affect active sessions — only new tasks pick up the change.

### 7. Concurrency Rebalancing

**Location**: `packages/opencode/src/devilcode/team/concurrency.ts`

Add method:
```typescript
/**
 * Rebalance slots after a position swap changes maxConcurrent.
 * If new max < active count, excess tasks are queued for next wave.
 * Returns { freed, queued } counts.
 */
rebalanceAfterSwap(role: string, oldMax: number, newMax: number): { freed: number; queued: number }
```

Behavior:
- If newMax >= oldMax: no-op (capacity increased or unchanged)
- If newMax < oldMax: mark excess slots as "pending release" (released when tasks complete)
- Does NOT preempt active tasks — they finish normally

## Test Specifications

### Unit Tests (`test/devilcode/team/position-swap.test.ts`)

| Test | Description |
|------|-------------|
| validates existing position | swap succeeds for valid position name |
| rejects unknown position | returns POSITION_NOT_FOUND |
| rejects invalid provider | returns INVALID_PROVIDER (not in known providers) |
| rejects invalid model | returns INVALID_MODEL (not offered by provider) |
| checks delegation hierarchy | returns DELEGATION_VIOLATION if parent can't delegate to swapped role |
| rebalances slots on capacity decrease | freed = oldMax - newMax when active < newMax |
| queues excess when active > newMax | queued = active - newMax |

### Chaos Tests (`test/devilcode/workflow/live-swap.test.ts`)

| Scenario | Setup | Action | Verification |
|----------|-------|--------|--------------|
| swap mid-wave | Start wave with 3 tasks | Swap role after task 1 starts | Task 1 finishes on old model; tasks 2-3 use new model |
| swap during review | Start review stage | Swap reviewer role | Current review finishes on old; re-review uses new |
| swap during challenge | Start challenge stage | Swap challenger role | Challenge finishes on old; next challenge uses new |
| capacity decrease | 2 tasks active, max=3 | Swap to max=1 | No preemption; next wave respects new max |
| invalid swap mid-workflow | Wave running | Attempt swap to typo model | Error returned; workflow continues unaffected |
| rapid consecutive swaps | Wave running | Swap A, then swap B | Both applied in order; final state reflects B |

### Integration Tests

| Test | Description |
|------|-------------|
| TUI command parsing | `/team swap senior-developer anthropic claude-sonnet-4-20250514` parses correctly |
| HTTP endpoint round-trip | POST to /devilcode/workflow/team/swap returns expected result |
| extension message flow | webview → handler → HTTP → response → webview |
| event emission | swap emits validating → success events in order |

## Documentation Deliverables

### 1. User Guide (`packages/devil-docs/pages/collaborate/teams/team-orchestrator-guide.md`)

Sections:
- Introduction to Team Orchestrator
- Creating a Team (TUI + VS Code)
- Starting a Workflow
- **Live Team Editing** (NEW)
  - When to swap positions
  - `/team swap` command syntax
  - What happens to in-flight tasks
  - Concurrency implications
- Monitoring and Telemetry
- Troubleshooting

### 2. Migration Guide (`packages/devil-docs/pages/collaborate/teams/workflow-tui-migration.md`)

Sections:
- What Changed (old workflow-tui → Team Orchestrator)
- Team Config Migration (old presets → canonical positions)
- Command Mapping (old commands → new commands)
- Breaking Changes
- FAQ

## Estimated LOC

| Component | New LOC | Test LOC |
|-----------|---------|----------|
| position-swap.ts | ~120 | ~80 |
| position-swap-events.ts | ~40 | ~20 |
| routes.ts (swap endpoint) | ~50 | ~30 |
| team-swap.ts (command) | ~40 | ~20 |
| team-builder-handler.ts | ~30 | ~20 |
| team-builder-types.ts | ~20 | — |
| concurrency.ts (rebalance) | ~40 | ~30 |
| live-swap.test.ts (chaos) | — | ~200 |
| User guide | ~300 | — |
| Migration guide | ~200 | — |
| **Total** | ~840 | ~400 |

## Open Questions (Resolved)

| Question | Resolution |
|----------|------------|
| Should swap persist to team config file? | YES — swap updates the active team config in repository |
| Should tier changes (worker → orchestrator) be allowed? | NO — tier affects hierarchy; user must edit role in team builder first |
| Should swap block during active task? | NO — swap is non-blocking; active tasks finish on old model |
| What if provider credentials invalid? | Fail at Session.create time with clear error; workflow not aborted |

## Dependencies

- Phase 9 complete (VS Code extension TeamBuilderHandler exists)
- Phase 8 complete (registry commands pattern for DI)
- Phase 6 complete (team persistence layer)

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Race between swap and task dispatch | LOW | MEDIUM | Swap updates config atomically; dispatch reads after update |
| Swap to invalid model | MEDIUM | LOW | Validation warns; error at Session.create is non-fatal |
| Concurrency over-subscription | LOW | MEDIUM | Rebalance marks excess as pending; no preemption |
| Swap log grows unbounded | LOW | LOW | Event log has existing rotation; swap events inherit |

## Success Criteria Checklist

- [ ] `/team swap <position> <provider> <model>` swaps position mid-workflow without aborting
- [ ] In-flight task finishes on old agent; new tasks route to new agent
- [ ] Concurrency slots rebalance when maxConcurrent changes
- [ ] Chaos tests pass: swap mid-wave, during review, during challenge
- [ ] User guide published at devil-docs
- [ ] Migration guide published at devil-docs
- [ ] All CI checks green: typecheck, knip, format, check-devilcode-change
