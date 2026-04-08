# Workflow TUI — Team Mission Control

**Date:** 2026-04-06
**Status:** Approved
**Depends on:** Multi-Model Multiplexing spec (2026-04-06-multi-model-multiplexing-design.md)

## Overview

A dedicated TUI view for managing the multi-model workflow engine. Acts as a mission control dashboard where the user directly drives the agent team through plan → challenge → build → review → ship → retro stages. Project-persistent state (`.planning/` on disk), session-scoped execution (agents only dispatch when the user is in the view and explicitly triggering stages).

## Design Decisions Summary

- **Dedicated route** — New `WorkflowRoute` in the TUI route system (not an overlay or slash-command-only approach)
- **Dashboard with tabbed detail pane** — Left: task list with wave grouping. Right: tabbed content (agent output, plan, challenge, review artifacts). Top: status bar. Bottom: command input.
- **The view IS the orchestrator** — Typing `build` in the command input dispatches agents. The view drives execution, streams results, and handles escalations.
- **Project-persistent state, session-scoped execution** — `.planning/` survives sessions. Active execution only happens while the user is in the view.

## Section 1: Route & Navigation

### Route Type

```typescript
export type WorkflowRoute = {
  type: "workflow"
  initialAction?: "plan" | "build" | "review"
}
```

Added to the existing `Route` union in `context/route.tsx`.

### Entry Points

1. `/team` slash command from any session — navigates to workflow view
2. Command palette: "Team Workflow" under "Workflow" category
3. If `.planning/STATE.md` exists with active phase, toast on project open suggests resuming

### Exit

- `Esc` or `/back` returns to previous route
- Execution pauses when leaving — no agents dispatch while out of view
- Re-entering reads `.planning/STATE.md` and picks up where left off

### Command Registration

New file `packages/opencode/src/devilcode/workflow-commands.tsx` following `kilo-commands.tsx` pattern:

```typescript
command.register(() => [
  {
    value: "workflow.open",
    title: "Team Workflow",
    slash: { name: "team", aliases: ["workflow"] },
    category: "Workflow",
    onSelect: () => route.navigate({ type: "workflow" }),
  },
  {
    value: "workflow.init",
    title: "Initialize Team Workflow",
    slash: { name: "team init" },
    category: "Workflow",
    enabled: !hasWorkflow(),
    onSelect: async () => { /* init .planning/, navigate to workflow */ },
  },
])
```

## Section 2: Dashboard Layout

### Component Tree

```
WorkflowView (route component)
├── WorkflowStatusBar          ← Top: phase, stage, wave, model indicators
├── WorkflowBody               ← Middle: split pane container
│   ├── TaskPanel              ← Left (~30%): task list with wave grouping
│   └── DetailPanel            ← Right (~70%): tabbed content area
│       ├── TabBar             ← Tab headers (agents, plan, challenge, review)
│       └── TabContent         ← Active tab's content
│           ├── AgentOutputTab ← Streaming agent output
│           ├── PlanTab        ← Plan files viewer
│           ├── ChallengeTab   ← Challenge results
│           └── ReviewTab      ← Review findings
├── WorkflowCommandInput       ← Bottom: workflow-specific command input
└── WorkflowToasts             ← Overlay: notifications
```

### Status Bar

```
┌─────────────────────────────────────────────────────────────┐
│ ◆ 01-auth-system │ BUILD │ Wave 2/3 │ ▲Opus ●Codex ○Kimi×2│
└─────────────────────────────────────────────────────────────┘
```

- Phase name with color (green=active, gray=pending, blue=complete)
- Stage with stage-specific color (plan=cyan, challenge=yellow, build=green, review=orange, ship=blue, retro=purple)
- Wave progress (BUILD stage only)
- Model indicators with role colors and fan-out counts

### Task Panel (Left, ~30% width)

```
  TASKS
  ─────────────────
  Wave 1
    ✓ 01-01 JWT middleware      senior
    ✓ 01-02 User model          worker
    ✓ 01-03 Auth tests          worker

  Wave 2
    ◐ 01-04 Auth routes         senior
    ◐ 01-05 Fix test fails      worker

  Wave 3
    ○ 01-06 Integration test    worker
  ─────────────────
  Progress: 3/6 tasks │ 1/3 waves
```

- Tasks grouped by wave
- Status icons: `✓` complete, `◐` in progress, `○` pending, `✗` failed, `↑` escalated, `◌` blocked
- Role as colored text (tier-specific color)
- Selecting a task (`>` marker) switches detail panel to that task's agent output
- Scrollable
- Wave summary at bottom

### Detail Panel (Right, ~70% width)

Tab bar:
```
  [Orchestrator] [Codex] [Kimi-1] [Kimi-2] │ [Plan] [Challenge] [Review]
```

- Agent tabs appear/disappear dynamically as agents dispatch/complete
- Artifact tabs (Plan, Challenge, Review) available once the stage has produced them
- Active tab highlighted with role tier color
- Agent tabs show streaming output from child sessions
- Artifact tabs render markdown from `.planning/` files

### Command Input (Bottom)

Custom prompt prefix `workflow>`. Accepts:

| Command | Stage | What it does |
|---------|-------|-------------|
| `plan` | Any | Triggers PLAN — orchestrator decomposes work |
| `challenge` | After plan | Triggers CHALLENGE — dispatches to Codex |
| `build` | After challenge | Triggers BUILD — executes waves |
| `review` | After build | Triggers REVIEW — dispatches reviewers |
| `ship` | After review | Triggers SHIP — commits and advances |
| `retro` | After ship | Triggers RETRO — logs learnings |
| `next` | Any | Advances to next valid stage |
| `status` | Any | Refreshes view from STATE.md |
| `pause` | During build | Pauses after current wave |
| `task <id>` | Any | Selects task, shows its output |
| `approve` | Challenge | Approves plan, advances to build |
| `revise` | Challenge | Sends plan back for revision |
| `retry <id>` | After failure | Re-dispatches a failed task |
| `back` | Any | Exits workflow view |

Free-text input sends guidance to the orchestrator.

### Responsive Behavior

- **120+ cols:** Full split layout
- **80-119 cols:** Task panel collapses to icons-only (status + ID, no title)
- **<80 cols:** Task panel hidden, toggle with `Tab` key

## Section 3: Execution Flow

### Session Architecture

```
Workflow Root Session (Opus - orchestrator)
├── Plan child session
├── Challenge child session (Codex)
├── Build child sessions (per wave)
│   ├── Wave 1: Task sessions (parallel)
│   └── Wave 2: Task sessions (parallel)
├── Review child sessions (Codex + Kimi workers)
└── Ship child session
```

Root session ID stored in STATE.md as `rootSessionId`. Re-entering resumes this session.

### Stage Execution

**PLAN:** View dispatches plan.txt prompt + CONTEXT.md to orchestrator. Orchestrator decomposes work, writes PLAN.md files. Task Panel updates in real-time. On completion, prompts user to challenge.

**CHALLENGE:** View dispatches plan files + source to Codex via `task("challenge-plan", "senior")`. Output streams to [Codex] tab. Returns PlanChallenge:
- `approved` → prompts `/build`
- `revise` → concerns render in [Challenge] tab, prompts `/plan` to revise
- `reject` → prompts `/plan` to re-plan
- Max 2 revision rounds

**BUILD:** View reads plans, validates wave integrity and file conflicts. For each wave sequentially:
1. Dispatches all wave tasks in parallel via orchestrator's `batch([task(...)])`
2. Agent tabs appear for each task
3. Task Panel status updates in real-time
4. Tasks write SUMMARY.md on completion
5. Escalations trigger toast + pause
6. Wave completes when all tasks finish
After all waves, prompts `/review`.

**REVIEW:** Dispatches code review → Codex, test/typecheck → Kimi workers. Runs `triageFindings()`. Results render in [Review] tab with severity colors (red=BLOCKER, yellow=WARNING, blue=SUGGESTION). If blockers found, auto-routes fixes via `routeFix()`, re-reviews changed files. Max 3 cycles. If cycles exhausted, escalates to user.

**SHIP:** Dispatches to orchestrator for commit synthesis. Creates atomic git commits. Updates ROADMAP.md. Prompts `/retro` or `/plan` for next phase.

### Real-Time Streaming

- Child sessions generate SSE events via existing infrastructure
- Workflow view subscribes to events from all active child sessions
- Messages routed to correct agent tab by session ID → role mapping
- Streaming text, tool calls, and results displayed as agent works

### Intervention

- `pause` during BUILD stops after current wave
- `task <id>` inspects specific agent output
- Free-text during any stage sends guidance to orchestrator
- `approve` at any stage overrides normal gate and advances
- Escalation toasts allow approve or redirect

### Error Recovery

- **Agent crash:** Concurrency slot released. Task status = `failed`. User can `retry <id>`.
- **Session dies mid-build:** STATE.md has last known state. Re-entering shows completed `✓`, failed `✗`, unstarted `○`. `build` resumes from current wave.
- **Rate limit:** Concurrency manager prevents over-dispatch. 429s retry with backoff. If exhausted, task returns `blocked`.

## Section 4: File Structure

### New Files

```
packages/opencode/src/devilcode/workflow-tui/
├── index.tsx                  # WorkflowView route component
├── status-bar.tsx             # Phase, stage, wave, model indicators
├── task-panel.tsx             # Left pane — task list with wave grouping
├── detail-panel.tsx           # Right pane — tab container
├── tabs/
│   ├── tab-bar.tsx            # Dynamic tab headers
│   ├── agent-output-tab.tsx   # Streaming session output
│   ├── plan-tab.tsx           # PLAN.md files viewer
│   ├── challenge-tab.tsx      # Challenge results + concerns
│   └── review-tab.tsx         # Findings with severity colors
├── command-input.tsx          # workflow> prompt with command dispatch
├── orchestrator.ts            # Drives stage execution, manages sessions
├── types.ts                   # View-specific types
└── context.tsx                # WorkflowContext provider
```

### Also Create

```
packages/opencode/src/devilcode/workflow-commands.tsx  # /team slash command registration
```

### Modified Files (with `devilcode_change` markers)

```
packages/opencode/src/cli/cmd/tui/context/route.tsx  — Add WorkflowRoute to Route union (~3 lines)
packages/opencode/src/cli/cmd/tui/app.tsx            — Add WorkflowView to route switch (~5 lines)
packages/opencode/src/devilcode/kilo-commands.tsx     — Register /team command (~15 lines)
```

### Context Provider

```typescript
type WorkflowViewState = {
  // From .planning/
  state: WorkflowState
  plans: PlanTask[]
  challenge: PlanChallenge | undefined
  review: ReviewVerdict | undefined

  // View state
  selectedTask: string | undefined
  activeTab: string
  tabs: TabInfo[]

  // Execution state
  executing: boolean
  activeSessions: Map<string, SessionInfo>

  // Actions
  executeStage(stage: WorkflowStage): Promise<void>
  selectTask(taskId: string): void
  switchTab(tabId: string): void
  sendCommand(command: string): void
  pause(): void
}
```

### Dependency Flow

```
WorkflowView (TUI) → WorkflowContext (view state)
    → WorkflowStateManager (.planning/ files)
    → WorkflowOrchestrator (execution)
        → resolveTaskModel (team routing)
        → ConcurrencyManager (slot tracking)
        → Workflow.advanceStage (state machine)
        → SessionPrompt.prompt (agent dispatch)
    → SSE events (child session output)
```

## What's NOT in Scope

- VS Code extension integration (separate spec if needed)
- Web UI / Desktop app integration
- Phase C features (memory, retrospective scoring, agent registry)
- Custom theme/color configuration for workflow view
- Keyboard-only navigation within dashboard (follow-up enhancement)
