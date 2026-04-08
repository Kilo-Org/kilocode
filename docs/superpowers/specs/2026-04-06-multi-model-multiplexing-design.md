# Multi-Model Multiplexing & Workflow Engine

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Phase B (multiplexing + workflow engine), designed for Phase C extension (learning/memory)

## Overview

Add hierarchical multi-model multiplexing to Devil Code, enabling a team of LLM agents with different models serving different roles — coordinated by a Legion-style workflow engine with structured lifecycle stages.

### Model Tiers

| Role | Model | Provider | Effort | Tier | Purpose |
|------|-------|----------|--------|------|---------|
| Orchestrator | Claude Opus 4.6 | Anthropic (OAuth) | MAX | 1 | Planning, decomposition, synthesis, final decisions |
| Senior | Codex GPT 5.4 | OpenAI (OAuth) | XHIGH | 2 | Debugging, architecture, complex implementation, plan challenge |
| Worker | Kimi 2.5 Turbo | Fireworks AI (API/subscription) | Default | 3 | Bounded implementation, testing, file operations |

### Access Model

All three models are accessed via subscription (not per-token API billing):
- Claude and Codex via OAuth within Devil Code (same as Claude Code / Codex CLI auth)
- Kimi via Fireworks API with flat-rate subscription
- Constraint is rate limits and concurrency, not token cost

## Architecture: Approach C — Kilocode Layer

Bulk of new code lives in `packages/opencode/src/devilcode/` (fork-specific path, no `devilcode_change` markers needed). Minimal integration points in 4 shared files (~38 lines total, 10 markers). Gated behind `config.team.enabled` — zero behavioral change when disabled.

## Section 1: Team Configuration & Role-Model Bindings

### Config Schema (`opencode.json`)

```jsonc
{
  "team": {
    "enabled": true,
    "roles": {
      "orchestrator": {
        "displayName": "Planner/Orchestrator",
        "provider": "anthropic",
        "model": "claude-opus-4-6",
        "effort": "max",
        "tier": 1,
        "canDelegate": ["senior", "worker"],
        "maxConcurrent": 1,
        "capabilities": ["planning", "decomposition", "synthesis", "review"]
      },
      "senior": {
        "displayName": "Debugger/Senior Engineer",
        "provider": "openai",
        "model": "gpt-5.4-codex",
        "effort": "xhigh",
        "tier": 2,
        "canDelegate": ["worker"],
        "maxConcurrent": 2,
        "capabilities": ["debugging", "architecture", "complex-implementation", "code-review"]
      },
      "worker": {
        "displayName": "Worker/Junior Engineer",
        "provider": "fireworks-ai",
        "model": "kimi-k2p5-turbo",
        "effort": "default",
        "tier": 3,
        "canDelegate": [],
        "maxConcurrent": 5,
        "capabilities": ["implementation", "testing", "file-operations", "search"]
      }
    },
    "routing": {
      "strategy": "hierarchical",
      "defaultRole": "worker",
      "escalationEnabled": true
    }
  }
}
```

### Zod Schema (`kilocode/team/config.ts`)

```typescript
const TeamRole = z.object({
  displayName: z.string(),
  provider: z.string(),
  model: z.string(),
  effort: z.enum(["max", "xhigh", "high", "medium", "low", "default"]).default("default"),
  tier: z.number().int().positive(),
  canDelegate: z.array(z.string()).default([]),
  maxConcurrent: z.number().int().positive().default(3),
  capabilities: z.array(z.string()).default([]),
})

const TeamRouting = z.object({
  strategy: z.enum(["hierarchical", "flat"]).default("hierarchical"),
  defaultRole: z.string(),
  escalationEnabled: z.boolean().default(true),
})

const TeamConfig = z.object({
  enabled: z.boolean().default(false),
  roles: z.record(z.string(), TeamRole),
  routing: TeamRouting,
})
```

### Design Decisions

- **`tier` enforces hierarchy** — Tier 1 delegates to 2 and 3, tier 2 to 3, tier 3 cannot delegate
- **`canDelegate` is explicit** — Allows non-standard hierarchies (e.g., a tier-2 reviewer that can't delegate)
- **`maxConcurrent` controls fan-out** — Rate-limit-aware per-role concurrency caps
- **`effort` maps to provider-specific reasoning** — `max` = Anthropic extended thinking, `xhigh` = OpenAI reasoningEffort high, `default` = model standard
- **`capabilities` are metadata for Phase C** — Future scoring/routing, currently informational
- **Roles are user-defined** — Not hardcoded to three; can add/remove/reconfigure

## Section 2: Workflow Engine — Phase Lifecycle & State Management

### Lifecycle Stages

```
plan → challenge → build → review → ship → retro
                                              │
  (repeats per phase until project complete) ◀┘
```

| Stage | Who | What |
|-------|-----|------|
| **plan** | Orchestrator (Opus) | Reads CONTEXT.md, decomposes into task plans, assigns roles and waves, writes PLAN.md files |
| **challenge** | Senior (Codex) | Adversarial review of plan — catches wrong assumptions, file conflicts, role misassignment, overengineering |
| **build** | Orchestrator dispatches | Wave-by-wave execution. Wave N tasks parallel via batch tool. Each task routed to assigned role's model |
| **review** | Orchestrator + Senior | Reviews all summaries + git diff. Findings triaged as BLOCKER/WARNING/SUGGESTION. BLOCKERs trigger fix cycle |
| **ship** | Orchestrator | Synthesizes changes, creates atomic commit(s), updates ROADMAP.md, advances to next phase |
| **retro** | Orchestrator | Logs what worked/failed. Phase C: writes OUTCOMES.md with scoring |

### State Files (`.planning/` directory)

```
.planning/
├── PROJECT.md              # Vision, constraints, success criteria
├── ROADMAP.md              # Phases with status, milestone grouping
├── STATE.md                # Current phase, stage, active tasks
├── phases/
│   ├── 01-auth-system/
│   │   ├── CONTEXT.md      # Requirements, relevant code, constraints
│   │   ├── 01-01-PLAN.md   # Task plan with YAML frontmatter
│   │   ├── 01-02-PLAN.md
│   │   ├── 01-01-SUMMARY.md # Execution results
│   │   ├── 01-02-SUMMARY.md
│   │   └── 01-REVIEW.md    # Review findings & verdict
│   └── 02-api-endpoints/
│       └── ...
└── milestones/             # Phase C: milestone summaries
    └── milestone-1.md
```

### STATE.md Structure

```yaml
---
project: <project-name>
currentPhase: 01-auth-system
currentStage: build          # plan | challenge | build | review | ship | retro
activeWave: 2
totalWaves: 3
activeTasks:
  - id: "01-02"
    role: senior
    status: in_progress
  - id: "01-03"
    role: worker
    status: in_progress
lastUpdated: 2026-04-06T14:30:00Z
---
```

### Plan File YAML Frontmatter

```yaml
---
id: "01-02"
title: "Implement JWT token validation"
role: senior
wave: 1
dependsOn: []
estimatedComplexity: high
files:
  - packages/opencode/src/auth/jwt.ts
  - packages/opencode/src/auth/middleware.ts
verification:
  - "bun test test/auth/jwt.test.ts"
  - "bun turbo typecheck"
---
```

### Design Decisions

- **Orchestrator stays in control at every stage** — Even during build, Opus calls batch with task invocations, sees every result, decides next wave
- **Files are source of truth** — STATE.md, PLAN.md, SUMMARY.md are git-committed markdown. Session death = resume from `.planning/`
- **Waves enforce file-conflict prevention** — Two tasks touching same files must be in different waves
- **Review has teeth** — BLOCKERs trigger fix dispatch + re-review (max 3 cycles)
- **Stages are skippable** — Quick single-task dispatch doesn't require full lifecycle

## Section 3: Wave Execution & Hierarchical Dispatch

### Dispatch Flow

1. Orchestrator reads STATE.md, identifies current wave's tasks
2. Groups tasks by role, calls `batch([task(..., role), ...])` for parallel execution
3. Each `task()` call goes through `resolveTaskModel()` which maps role → provider/model/effort
4. Results collected, orchestrator evaluates, advances to next wave or stage

### Hierarchical Sub-Delegation (Codex → Kimi fan-out)

Senior-tier agents that receive complex tasks can decompose and fan out to workers:
- Senior keeps complex/security-sensitive subtasks for itself
- Delegates bounded, pattern-based subtasks to multiple Worker instances in parallel
- Synthesizes all results before returning to orchestrator
- Uses the same `batch([task(..., "worker")])` mechanism — no special API

### Model Resolution (`resolveTaskModel()`)

```typescript
function resolveTaskModel(
  subagentType: string,
  teamConfig: TeamConfig,
  parentRole: string,
): { providerID: string; modelID: string; effort: string } | undefined {
  // 1. If team not enabled → undefined (existing behavior)
  // 2. Map subagentType to role → resolve provider/model
  // 3. Enforce hierarchy — parent.canDelegate must include subagentType
  // 4. Check concurrency limits → wait for slot if at capacity
  // 5. Return resolved model
}
```

### Concurrency Control

```typescript
const ConcurrencyManager = {
  active: Map<string, Set<string>>  // role → set of active task IDs
  acquire(role, taskId): Promise<void>
  release(role, taskId): void
  getActiveCount(role): number
}
```

- Uses BusEvent to track task start/completion across session tree
- Per-role limits prevent overwhelming provider rate limits
- Workers: 5 concurrent (meaningful fan-out). Senior: 2. Orchestrator: 1.

### Escalation

Tasks return structured `TaskResult`:

```typescript
const TaskResult = z.object({
  status: z.enum(["completed", "escalated", "blocked", "failed"]),
  output: z.string(),
  filesModified: z.array(z.string()).default([]),
  escalation: z.object({
    reason: z.string(),
    suggestedRole: z.string().optional(),
    context: z.string(),
  }).optional(),
})
```

- `escalated` — Parent re-dispatches to same or higher tier
- `blocked` — Parent waits and retries or re-routes to different provider
- Codex escalation flows back to Opus for re-planning

### Design Decisions

- **`subagent_type` doubles as role identifier** — `task("fix tests", { subagent_type: "worker" })` resolves worker → Kimi via team config. Unknown roles fall back to existing behavior
- **Concurrency is per-role, not per-model** — Independent limits even if two roles use the same model
- **Escalation is structured, not conversational** — Typed `TaskResult` with status enum, not natural language "I need help"
- **Sub-delegation uses same mechanism** — Codex calling `batch([task(..., "worker")])` hits identical `resolveTaskModel` path

## Section 4: Plan Challenge — Adversarial Verification

### Purpose

Codex (Senior) mandatory review of every plan before execution. Different model with different reasoning patterns catches blind spots the orchestrator can't self-detect.

### Challenge Schema

```typescript
const PlanChallenge = z.object({
  planId: z.string(),
  verdict: z.enum(["approved", "revise", "reject"]),
  concerns: z.array(z.object({
    severity: z.enum(["critical", "moderate", "minor"]),
    category: z.enum([
      "missing-dependency",
      "wrong-wave-ordering",
      "underestimated-complexity",
      "security-risk",
      "overengineered",
      "file-conflict",
      "missing-verification",
      "incorrect-assumption",
    ]),
    description: z.string(),
    suggestedChange: z.string(),
    affectedTasks: z.array(z.string()),
  })),
  alternativeApproach: z.string().optional(),
  summary: z.string(),
})
```

### Flow

1. Opus generates PLAN.md files
2. Opus dispatches plan + CONTEXT.md + relevant source files to Codex as `task("challenge-plan", "senior")`
3. Codex returns `PlanChallenge` verdict:
   - `approved` → Proceed to BUILD
   - `revise` → Opus revises affected PLAN.md files, re-submits (max 2 revision rounds)
   - `reject` → Opus re-plans from scratch or escalates to user
4. After 2 failed revision rounds → escalate to user with both perspectives

### Design Decisions

- **Challenge is mandatory** — Every plan goes through Codex before execution
- **Codex sees source code, not just the plan** — Catches incorrect assumptions about existing codebase
- **2-round revision cap** — Prevents infinite Opus/Codex ping-pong
- **`alternativeApproach` is first-class** — Codex can propose alternatives, Opus decides whether to adopt
- **"Reject" triggers re-plan, not abort** — System recovers unless the disagreement is fundamental

## Section 5: Review Loop & Fix Routing

### Review Flow

1. BUILD completes (all waves done)
2. Orchestrator reads SUMMARY.md files + git diff
3. Dispatches review tasks: code review → Senior (Codex), test suite + typecheck → Workers (Kimi)
4. Findings collected and triaged by severity
5. BLOCKERs trigger fix cycle (max 3 iterations)
6. Fix routing: security/architecture → Senior, test failures/type errors → Worker
7. After fixes: re-run verification commands, re-review changed files only
8. 3 cycles without resolution → escalate to user

### Review Finding Schema

```typescript
const ReviewFinding = z.object({
  id: z.string(),
  severity: z.enum(["blocker", "warning", "suggestion"]),
  category: z.enum([
    "security", "correctness", "performance",
    "type-safety", "test-coverage", "style",
    "architecture", "compatibility",
  ]),
  file: z.string(),
  line: z.number().optional(),
  description: z.string(),
  suggestedFix: z.string().optional(),
  suggestedRole: z.string().optional(),
  verificationCommand: z.string().optional(),
})

const ReviewVerdict = z.object({
  verdict: z.enum(["pass", "fail", "escalate"]),
  cycle: z.number(),
  findings: z.array(ReviewFinding),
  blockerCount: z.number(),
  warningCount: z.number(),
  suggestionCount: z.number(),
  summary: z.string(),
})
```

### Fix Routing Logic

```
Security / architecture issues       → Senior (Codex)
Correctness blockers                  → Senior (Codex)
Test failures / type errors / style   → Worker (Kimi)
Finding with suggestedRole            → Honor the suggestion
Everything else                       → Worker (Kimi)
```

### Design Decisions

- **Multi-modal review** — Codex does deep code review, Kimi runs mechanical checks (tests, types, lint). Orchestrator synthesizes.
- **3-cycle hard limit** — Prevents infinite fix loops. Escalates to user with full report.
- **Scoped re-review** — After fixes, only changed files re-reviewed and only failing verifications re-run
- **WARNINGs don't block** — Logged in REVIEW.md, addressable later. System enforces correctness and security, doesn't chase perfection.

## Section 6: Integration Points — Shared File Changes

### Files Modified (with `devilcode_change` markers)

| File | Lines | What |
|------|-------|------|
| `config/config.ts` | ~4 | Import TeamConfig, add `team` to Config.Info schema |
| `tool/task.ts` | ~20 | Import router, call resolveTaskModel(), apply model override; unlock task nesting for delegating roles |
| `agent/agent.ts` | ~6 | Import and register workflow-specific agents when team enabled |
| `session/prompt.ts` | ~8 | Import workflow state, inject current phase/stage context into system prompt |
| **Total** | **~38** | **10 markers** |

### Activation Gate

```typescript
if (config.team?.enabled) {
  // Team routing, workflow agents, .planning/ state, hierarchical dispatch
} else {
  // Zero behavioral change, zero performance impact
}
```

## Section 7: New Code Structure

```
packages/opencode/src/devilcode/
├── team/
│   ├── config.ts          # TeamConfig, TeamRole Zod schemas
│   ├── router.ts          # resolveTaskModel(), hierarchy enforcement
│   ├── concurrency.ts     # ConcurrencyManager, slot acquisition
│   ├── agents.ts          # registerWorkflowAgents(), dynamic agent defs
│   └── types.ts           # Shared types
│
├── workflow/
│   ├── index.ts           # Workflow namespace, stage transitions, state machine
│   ├── state.ts           # .planning/ file I/O, YAML frontmatter parsing
│   ├── planner.ts         # Phase decomposition, wave assignment
│   ├── challenger.ts      # Plan challenge dispatch, revision loop
│   ├── executor.ts        # Wave executor, batch dispatch with model routing
│   ├── reviewer.ts        # Review loop, finding triage, fix routing
│   ├── shipper.ts         # Commit synthesis, roadmap updates, stage advance
│   ├── types.ts           # All Zod schemas
│   └── prompts/
│       ├── plan.txt
│       ├── challenge.txt
│       ├── build.txt
│       ├── review.txt
│       └── ship.txt
│
└── workflow/__future__/   # Phase C stubs (interfaces only)
    ├── memory.ts          # OUTCOMES.md, time-decay scoring
    ├── retro.ts           # Retrospective protocol
    ├── registry.ts        # Agent registry with weighted scoring
    └── milestone.ts       # Milestone management, archiving
```

## What's NOT Changing

- **Provider system** — provider.ts, models.ts, model-cache.ts untouched
- **Session management** — Sessions work identically; task tool passes different model for child sessions
- **TUI / VS Code extension** — No UI changes in this phase
- **ACP protocol** — External clients unaffected
- **MCP infrastructure** — MCP tools available to all agents regardless of tier

## Phase C Extension Points

The following are designed-for but not implemented:

- **`capabilities` on roles** — For scored routing (match task requirements to role capabilities)
- **`TaskResult.filesModified`** — For automated review scoping and memory tracking
- **`__future__/memory.ts`** — OUTCOMES.md with time-decay agent performance scoring
- **`__future__/retro.ts`** — Structured retrospective protocol after phases/milestones
- **`__future__/registry.ts`** — Weighted agent registry (keyword match + division affinity + history boost)
- **`__future__/milestone.ts`** — Milestone grouping, archiving completed phases
- **`ConcurrencyManager`** — Can integrate with provider rate-limit response headers
- **`PlanChallenge.alternativeApproach`** — Can feed into learning system for approach comparison
