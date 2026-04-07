# Workflow TUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a dedicated TUI dashboard for managing the multi-model workflow engine — a mission control view with task list, tabbed agent output, status bar, and command-driven stage execution.

**Architecture:** New `WorkflowRoute` in the existing route system. Dashboard uses SolidJS + OpenTUI with split-pane layout (task list left, tabbed detail right). A `WorkflowOrchestrator` bridges the view to the workflow engine (state manager, team router, concurrency manager). Agent output streams via SSE subscriptions to child sessions. All new code in `packages/opencode/src/devilcode/workflow-tui/`.

**Tech Stack:** SolidJS, OpenTUI (`@opentui/solid`), gray-matter, existing Devil Code SDK + SSE infrastructure.

**Spec:** `docs/superpowers/specs/2026-04-06-workflow-tui-design.md`

**Prerequisite:** The multi-model multiplexing implementation must be complete (branch `feat/multi-model-multiplexing`). The following modules are already built:
- `packages/opencode/src/devilcode/team/` — config, router, concurrency, effort
- `packages/opencode/src/devilcode/workflow/` — types, state, executor, reviewer, index (state machine)
- Integration in `tool/task.ts`, `config/config.ts`, `agent/agent.ts`, `session/prompt.ts`

**Key reference files for TUI patterns:**
- Route component pattern: `packages/opencode/src/devilcode/claw/view.tsx`
- Layout primitives: `packages/opencode/src/cli/cmd/tui/app.tsx`
- Split pane: `packages/opencode/src/devilcode/claw/view.tsx:61-86`
- SSE events: `packages/opencode/src/cli/cmd/tui/context/sdk.tsx`
- Command registration: `packages/opencode/src/devilcode/kilo-commands.tsx`
- Toast: `packages/opencode/src/cli/cmd/tui/ui/toast.tsx`
- Theme: `packages/opencode/src/cli/cmd/tui/context/theme.tsx`
- Textarea input: `packages/opencode/src/devilcode/claw/chat.tsx:166-183`
- Scrollable list: `packages/opencode/src/devilcode/claw/chat.tsx:109-144`

---

## File Structure

### New Files

```
packages/opencode/src/devilcode/workflow-tui/
  types.ts              — View-specific types (TabInfo, SessionInfo, command types)
  context.tsx           — WorkflowContext provider (shared view state + actions)
  orchestrator.ts       — Bridges view to workflow engine, manages sessions
  index.tsx             — WorkflowView route component (layout shell)
  status-bar.tsx        — Top bar: phase, stage, wave, model indicators
  task-panel.tsx        — Left pane: scrollable task list grouped by wave
  detail-panel.tsx      — Right pane: tab container with tab bar + content
  tabs/
    tab-bar.tsx         — Dynamic tab headers
    agent-output-tab.tsx — Streaming agent session output
    plan-tab.tsx        — PLAN.md files viewer
    challenge-tab.tsx   — Challenge results with concerns
    review-tab.tsx      — Review findings with severity colors
  command-input.tsx     — Bottom: workflow> prompt with command dispatch

packages/opencode/src/devilcode/workflow-commands.tsx  — /team slash command registration
```

### Modified Files (with `devilcode_change` markers)

```
packages/opencode/src/cli/cmd/tui/context/route.tsx  — Add WorkflowRoute to Route union
packages/opencode/src/cli/cmd/tui/app.tsx            — Add WorkflowView to route switch + register commands
```

---

## Task 1: View Types

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/types.ts`

- [ ] **Step 1: Create the view types file**

```typescript
// packages/opencode/src/devilcode/workflow-tui/types.ts
import type { WorkflowStage, PlanTask, PlanChallenge, ReviewVerdict, WorkflowState } from "../workflow/types"

export type TabKind = "agent" | "plan" | "challenge" | "review"

export type TabInfo = {
  id: string
  label: string
  kind: TabKind
  roleColor?: string
  sessionId?: string
  taskId?: string
  closeable: boolean
}

export type SessionInfo = {
  sessionId: string
  taskId: string
  role: string
  status: "running" | "completed" | "failed" | "escalated"
  output: string[]
}

export type WorkflowCommand =
  | "plan"
  | "challenge"
  | "build"
  | "review"
  | "ship"
  | "retro"
  | "next"
  | "status"
  | "pause"
  | "approve"
  | "revise"
  | "back"

export type TaskStatusIcon = "✓" | "◐" | "○" | "✗" | "↑" | "◌"

export function taskStatusIcon(status: string): TaskStatusIcon {
  switch (status) {
    case "completed":
      return "✓"
    case "in_progress":
      return "◐"
    case "pending":
      return "○"
    case "failed":
      return "✗"
    case "escalated":
      return "↑"
    case "blocked":
      return "◌"
    default:
      return "○"
  }
}

export function stageColor(stage: WorkflowStage): string {
  switch (stage) {
    case "plan":
      return "cyan"
    case "challenge":
      return "yellow"
    case "build":
      return "green"
    case "review":
      return "#FF8C00"
    case "ship":
      return "blue"
    case "retro":
      return "magenta"
  }
}

export const WORKFLOW_COMMANDS: WorkflowCommand[] = [
  "plan", "challenge", "build", "review", "ship", "retro",
  "next", "status", "pause", "approve", "revise", "back",
]

export function isWorkflowCommand(input: string): input is WorkflowCommand {
  return WORKFLOW_COMMANDS.includes(input as WorkflowCommand)
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/types.ts
git commit -m "feat(cli): add workflow TUI view types"
```

---

## Task 2: WorkflowContext Provider

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/context.tsx`

- [ ] **Step 1: Create the context provider**

This is the shared state for all workflow view components. It reads `.planning/` state, tracks active sessions, manages tab state, and provides actions.

```typescript
// packages/opencode/src/devilcode/workflow-tui/context.tsx
import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { onMount, onCleanup } from "solid-js"
import type { WorkflowState, PlanTask, PlanChallenge, ReviewVerdict, WorkflowStage } from "../workflow/types"
import type { TabInfo, SessionInfo } from "./types"
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { Instance } from "@/project/instance"

export type WorkflowViewState = {
  state: WorkflowState | undefined
  plans: PlanTask[]
  challenge: PlanChallenge | undefined
  review: ReviewVerdict | undefined

  selectedTask: string | undefined
  activeTab: string
  tabs: TabInfo[]

  executing: boolean
  activeSessions: Record<string, SessionInfo>
  rootSessionId: string | undefined

  // Actions
  refresh(): Promise<void>
  executeStage(stage: WorkflowStage): Promise<void>
  selectTask(taskId: string): void
  switchTab(tabId: string): void
  addAgentTab(info: TabInfo): void
  updateSessionOutput(sessionId: string, line: string): void
  setSessionStatus(sessionId: string, status: SessionInfo["status"]): void
  pause(): void
  setExecuting(value: boolean): void
}

const WorkflowCtx = createContext<WorkflowViewState>()

export function WorkflowProvider(props: ParentProps) {
  const manager = new WorkflowStateManager(Instance.directory)

  const [store, setStore] = createStore<{
    state: WorkflowState | undefined
    plans: PlanTask[]
    challenge: PlanChallenge | undefined
    review: ReviewVerdict | undefined
    selectedTask: string | undefined
    activeTab: string
    tabs: TabInfo[]
    executing: boolean
    activeSessions: Record<string, SessionInfo>
    rootSessionId: string | undefined
  }>({
    state: undefined,
    plans: [],
    challenge: undefined,
    review: undefined,
    selectedTask: undefined,
    activeTab: "plan",
    tabs: [
      { id: "plan", label: "Plan", kind: "plan", closeable: false },
    ],
    executing: false,
    activeSessions: {},
    rootSessionId: undefined,
  })

  async function refresh() {
    try {
      if (!(await manager.hasWorkflow())) return
      const state = await manager.readState()
      setStore("state", state)

      if (state.currentPhase) {
        try {
          const plans = await manager.readAllPlans(state.currentPhase)
          setStore("plans", plans)
        } catch {
          setStore("plans", [])
        }

        try {
          const review = await manager.readReview(state.currentPhase)
          setStore("review", review)
          // Add review tab if not present
          if (!store.tabs.find((t) => t.id === "review")) {
            setStore("tabs", (tabs) => [
              ...tabs,
              { id: "review", label: "Review", kind: "review" as const, closeable: false },
            ])
          }
        } catch {
          // No review yet
        }
      }
    } catch {
      // .planning/ not initialized
    }
  }

  onMount(() => {
    refresh()
    const interval = setInterval(refresh, 5000)
    onCleanup(() => clearInterval(interval))
  })

  const value: WorkflowViewState = {
    get state() {
      return store.state
    },
    get plans() {
      return store.plans
    },
    get challenge() {
      return store.challenge
    },
    get review() {
      return store.review
    },
    get selectedTask() {
      return store.selectedTask
    },
    get activeTab() {
      return store.activeTab
    },
    get tabs() {
      return store.tabs
    },
    get executing() {
      return store.executing
    },
    get activeSessions() {
      return store.activeSessions
    },
    get rootSessionId() {
      return store.rootSessionId
    },

    refresh,

    async executeStage(stage: WorkflowStage) {
      setStore("executing", true)
      try {
        await Workflow.advanceStage(manager, stage)
        await refresh()
      } catch (e) {
        setStore("executing", false)
        throw e
      }
    },

    selectTask(taskId: string) {
      setStore("selectedTask", taskId)
      // If there's an agent tab for this task, switch to it
      const agentTab = store.tabs.find(
        (t) => t.kind === "agent" && t.taskId === taskId,
      )
      if (agentTab) {
        setStore("activeTab", agentTab.id)
      }
    },

    switchTab(tabId: string) {
      setStore("activeTab", tabId)
    },

    addAgentTab(info: TabInfo) {
      setStore("tabs", (tabs) => {
        if (tabs.find((t) => t.id === info.id)) return tabs
        return [...tabs, info]
      })
      setStore("activeTab", info.id)
    },

    updateSessionOutput(sessionId: string, line: string) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.output.push(line)
          }
        }),
      )
    },

    setSessionStatus(sessionId: string, status: SessionInfo["status"]) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.status = status
          }
        }),
      )
    },

    pause() {
      setStore("executing", false)
    },

    setExecuting(value: boolean) {
      setStore("executing", value)
    },
  }

  return (
    <WorkflowCtx.Provider value={value}>
      {props.children}
    </WorkflowCtx.Provider>
  )
}

export function useWorkflow(): WorkflowViewState {
  const ctx = useContext(WorkflowCtx)
  if (!ctx) throw new Error("useWorkflow must be used within WorkflowProvider")
  return ctx
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/context.tsx
git commit -m "feat(cli): add WorkflowContext provider with state management and actions"
```

---

## Task 3: Status Bar Component

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/status-bar.tsx`

- [ ] **Step 1: Create the status bar**

```typescript
// packages/opencode/src/devilcode/workflow-tui/status-bar.tsx
import { Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { stageColor } from "./types"

export function WorkflowStatusBar() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <box
      flexDirection="row"
      height={1}
      backgroundColor={theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={2}
      gap={2}
      alignItems="center"
    >
      <Show
        when={wf.state}
        fallback={
          <text fg={theme.textMuted}>No workflow initialized. Type "plan" to start.</text>
        }
      >
        {(state) => (
          <>
            <text fg={theme.primary}>
              <b>{"◆ " + (state().currentPhase || "(no phase)")}</b>
            </text>
            <text fg={stageColor(state().currentStage)}>
              <b>{state().currentStage.toUpperCase()}</b>
            </text>
            <Show when={state().activeWave !== undefined && state().totalWaves !== undefined}>
              <text fg={theme.text}>
                {"Wave " + state().activeWave + "/" + state().totalWaves}
              </text>
            </Show>
            <Show when={wf.executing}>
              <text fg={theme.warning}>● EXECUTING</text>
            </Show>
          </>
        )}
      </Show>
    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/status-bar.tsx
git commit -m "feat(cli): add workflow status bar component"
```

---

## Task 4: Task Panel Component

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/task-panel.tsx`

- [ ] **Step 1: Create the task panel**

```typescript
// packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { taskStatusIcon } from "./types"
import { groupByWave } from "../workflow/executor"

export function TaskPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const waves = createMemo(() => groupByWave(wf.plans))

  const completedCount = createMemo(() => {
    const active = wf.state?.activeTasks ?? []
    return active.filter((t) => t.status === "completed").length
  })

  return (
    <box
      flexDirection="column"
      width={32}
      backgroundColor={theme.backgroundPanel}
      paddingTop={1}
      paddingLeft={2}
      paddingRight={1}
    >
      <text fg={theme.text} attributes={{ bold: true }}>
        TASKS
      </text>
      <text fg={theme.border}>{"─".repeat(28)}</text>

      <scrollbox flexGrow={1}>
        <Show
          when={wf.plans.length > 0}
          fallback={<text fg={theme.textMuted}>No tasks planned yet</text>}
        >
          <For each={[...waves().entries()]}>
            {([waveNum, tasks]) => (
              <box flexDirection="column" marginBottom={1}>
                <text fg={theme.textMuted}>{"Wave " + waveNum}</text>
                <For each={tasks}>
                  {(task) => {
                    const activeTask = createMemo(() =>
                      wf.state?.activeTasks.find((t) => t.id === task.id),
                    )
                    const status = createMemo(() => activeTask()?.status ?? "pending")
                    const icon = createMemo(() => taskStatusIcon(status()))
                    const isSelected = createMemo(() => wf.selectedTask === task.id)
                    const statusColor = createMemo(() => {
                      switch (status()) {
                        case "completed":
                          return theme.success
                        case "in_progress":
                          return theme.warning
                        case "failed":
                          return theme.error
                        case "escalated":
                          return theme.error
                        case "blocked":
                          return theme.textMuted
                        default:
                          return theme.textMuted
                      }
                    })

                    return (
                      <box
                        flexDirection="row"
                        gap={1}
                        onMouseDown={() => wf.selectTask(task.id)}
                      >
                        <text fg={isSelected() ? theme.primary : theme.text}>
                          {isSelected() ? ">" : " "}
                        </text>
                        <text fg={statusColor()}>{icon()}</text>
                        <text
                          fg={isSelected() ? theme.primary : theme.text}
                          flexGrow={1}
                          overflow="truncate"
                        >
                          {task.id + " " + task.title}
                        </text>
                        <text fg={theme.textMuted}>{task.role}</text>
                      </box>
                    )
                  }}
                </For>
              </box>
            )}
          </For>
        </Show>
      </scrollbox>

      <text fg={theme.border}>{"─".repeat(28)}</text>
      <text fg={theme.textMuted}>
        {"Progress: " + completedCount() + "/" + wf.plans.length + " tasks"}
      </text>
    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/task-panel.tsx
git commit -m "feat(cli): add workflow task panel with wave grouping"
```

---

## Task 5: Tab Bar & Detail Panel

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx`
- Create: `packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx`

- [ ] **Step 1: Create the tab bar**

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx
import { For, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function TabBar() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const agentTabs = createMemo(() => wf.tabs.filter((t) => t.kind === "agent"))
  const artifactTabs = createMemo(() => wf.tabs.filter((t) => t.kind !== "agent"))

  return (
    <box flexDirection="row" height={1} gap={1} paddingLeft={1}>
      <For each={agentTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <text
              fg={isActive() ? theme.primary : theme.textMuted}
              attributes={isActive() ? { bold: true } : {}}
              onMouseDown={() => wf.switchTab(tab.id)}
            >
              {"[" + tab.label + "]"}
            </text>
          )
        }}
      </For>
      <Show when={agentTabs().length > 0 && artifactTabs().length > 0}>
        <text fg={theme.border}>│</text>
      </Show>
      <For each={artifactTabs()}>
        {(tab) => {
          const isActive = createMemo(() => wf.activeTab === tab.id)
          return (
            <text
              fg={isActive() ? theme.primary : theme.textMuted}
              attributes={isActive() ? { bold: true } : {}}
              onMouseDown={() => wf.switchTab(tab.id)}
            >
              {"[" + tab.label + "]"}
            </text>
          )
        }}
      </For>
    </box>
  )
}
```

- [ ] **Step 2: Create the detail panel container**

```typescript
// packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx
import { Show, Switch, Match, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "./context"
import { TabBar } from "./tabs/tab-bar"
import { AgentOutputTab } from "./tabs/agent-output-tab"
import { PlanTab } from "./tabs/plan-tab"
import { ChallengeTab } from "./tabs/challenge-tab"
import { ReviewTab } from "./tabs/review-tab"

export function DetailPanel() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const activeTabInfo = createMemo(() => wf.tabs.find((t) => t.id === wf.activeTab))

  return (
    <box
      flexDirection="column"
      flexGrow={1}
      backgroundColor={theme.background}
      paddingLeft={1}
      minHeight={0}
    >
      <TabBar />
      <box
        flexGrow={1}
        flexDirection="column"
        border={["top"]}
        borderColor={theme.border}
        minHeight={0}
      >
        <Switch fallback={<text fg={theme.textMuted}>Select a tab</text>}>
          <Match when={activeTabInfo()?.kind === "agent"}>
            <AgentOutputTab tabId={wf.activeTab} />
          </Match>
          <Match when={activeTabInfo()?.kind === "plan"}>
            <PlanTab />
          </Match>
          <Match when={activeTabInfo()?.kind === "challenge"}>
            <ChallengeTab />
          </Match>
          <Match when={activeTabInfo()?.kind === "review"}>
            <ReviewTab />
          </Match>
        </Switch>
      </box>
    </box>
  )
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/tabs/tab-bar.tsx packages/opencode/src/devilcode/workflow-tui/detail-panel.tsx
git commit -m "feat(cli): add tab bar and detail panel container"
```

---

## Task 6: Tab Content Components

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/agent-output-tab.tsx`
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/plan-tab.tsx`
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/challenge-tab.tsx`
- Create: `packages/opencode/src/devilcode/workflow-tui/tabs/review-tab.tsx`

- [ ] **Step 1: Create agent output tab**

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/agent-output-tab.tsx
import { For, Show, createMemo } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function AgentOutputTab(props: { tabId: string }) {
  const { theme } = useTheme()
  const wf = useWorkflow()

  const session = createMemo(() => {
    const tab = wf.tabs.find((t) => t.id === props.tabId)
    if (!tab?.sessionId) return undefined
    return wf.activeSessions[tab.sessionId]
  })

  return (
    <scrollbox
      flexGrow={1}
      stickyScroll={true}
      stickyStart="bottom"
      paddingLeft={1}
      paddingRight={1}
    >
      <Show
        when={session()}
        fallback={<text fg={theme.textMuted}>Waiting for agent output...</text>}
      >
        {(s) => (
          <For each={s().output}>
            {(line) => (
              <text fg={theme.text} wrapMode="word" width="100%">
                {line}
              </text>
            )}
          </For>
        )}
      </Show>
    </scrollbox>
  )
}
```

- [ ] **Step 2: Create plan tab**

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/plan-tab.tsx
import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function PlanTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.plans.length > 0}
        fallback={
          <text fg={theme.textMuted}>
            No plans yet. Type "plan" to start decomposition.
          </text>
        }
      >
        <For each={wf.plans}>
          {(plan) => (
            <box flexDirection="column" marginBottom={1}>
              <text fg={theme.primary} attributes={{ bold: true }}>
                {"[" + plan.id + "] " + plan.title}
              </text>
              <text fg={theme.textMuted}>
                {"  Role: " + plan.role + " │ Wave: " + plan.wave + " │ Complexity: " + plan.estimatedComplexity}
              </text>
              <Show when={plan.files.length > 0}>
                <text fg={theme.textMuted}>
                  {"  Files: " + plan.files.join(", ")}
                </text>
              </Show>
              <text fg={theme.text} wrapMode="word" width="100%" paddingLeft={2}>
                {plan.description}
              </text>
            </box>
          )}
        </For>
      </Show>
    </scrollbox>
  )
}
```

- [ ] **Step 3: Create challenge tab**

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/challenge-tab.tsx
import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function ChallengeTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.challenge}
        fallback={
          <text fg={theme.textMuted}>
            No challenge results yet. Run "challenge" after planning.
          </text>
        }
      >
        {(challenge) => (
          <box flexDirection="column">
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text
                fg={
                  challenge().verdict === "approved"
                    ? theme.success
                    : challenge().verdict === "reject"
                      ? theme.error
                      : theme.warning
                }
                attributes={{ bold: true }}
              >
                {"Verdict: " + challenge().verdict.toUpperCase()}
              </text>
            </box>
            <text fg={theme.text} wrapMode="word" width="100%" marginBottom={1}>
              {challenge().summary}
            </text>
            <Show when={challenge().concerns.length > 0}>
              <text fg={theme.text} attributes={{ bold: true }} marginBottom={1}>
                Concerns:
              </text>
              <For each={challenge().concerns}>
                {(concern) => (
                  <box flexDirection="column" marginBottom={1} paddingLeft={2}>
                    <text
                      fg={
                        concern.severity === "critical"
                          ? theme.error
                          : concern.severity === "moderate"
                            ? theme.warning
                            : theme.info
                      }
                    >
                      {"[" + concern.severity.toUpperCase() + "] " + concern.category}
                    </text>
                    <text fg={theme.text} wrapMode="word" width="100%">
                      {concern.description}
                    </text>
                    <text fg={theme.textMuted}>
                      {"Fix: " + concern.suggestedChange}
                    </text>
                    <Show when={concern.affectedTasks.length > 0}>
                      <text fg={theme.textMuted}>
                        {"Tasks: " + concern.affectedTasks.join(", ")}
                      </text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
            <Show when={challenge().alternativeApproach}>
              <text fg={theme.info} attributes={{ bold: true }}>
                Alternative Approach:
              </text>
              <text fg={theme.text} wrapMode="word" width="100%">
                {challenge().alternativeApproach}
              </text>
            </Show>
          </box>
        )}
      </Show>
    </scrollbox>
  )
}
```

- [ ] **Step 4: Create review tab**

```typescript
// packages/opencode/src/devilcode/workflow-tui/tabs/review-tab.tsx
import { For, Show } from "solid-js"
import { useTheme } from "@tui/context/theme"
import { useWorkflow } from "../context"

export function ReviewTab() {
  const { theme } = useTheme()
  const wf = useWorkflow()

  function severityColor(severity: string) {
    switch (severity) {
      case "blocker":
        return theme.error
      case "warning":
        return theme.warning
      case "suggestion":
        return theme.info
      default:
        return theme.text
    }
  }

  return (
    <scrollbox flexGrow={1} paddingLeft={1} paddingRight={1}>
      <Show
        when={wf.review}
        fallback={
          <text fg={theme.textMuted}>
            No review results yet. Run "review" after building.
          </text>
        }
      >
        {(review) => (
          <box flexDirection="column">
            <box flexDirection="row" gap={2} marginBottom={1}>
              <text
                fg={review().verdict === "pass" ? theme.success : theme.error}
                attributes={{ bold: true }}
              >
                {"Verdict: " + review().verdict.toUpperCase()}
              </text>
              <text fg={theme.textMuted}>
                {"Cycle " + review().cycle + " │ " + review().blockerCount + " blockers │ " + review().warningCount + " warnings │ " + review().suggestionCount + " suggestions"}
              </text>
            </box>
            <Show when={review().findings.length > 0}>
              <For each={review().findings}>
                {(finding) => (
                  <box flexDirection="column" marginBottom={1} paddingLeft={2}>
                    <text fg={severityColor(finding.severity)}>
                      {finding.id + " [" + finding.severity.toUpperCase() + "] " + finding.category}
                    </text>
                    <text fg={theme.text} wrapMode="word" width="100%">
                      {finding.description}
                    </text>
                    <text fg={theme.textMuted}>
                      {"File: " + finding.file + (finding.line ? ":" + finding.line : "")}
                    </text>
                    <Show when={finding.suggestedFix}>
                      <text fg={theme.textMuted}>{"Fix: " + finding.suggestedFix}</text>
                    </Show>
                  </box>
                )}
              </For>
            </Show>
            <text fg={theme.text} wrapMode="word" width="100%" marginTop={1}>
              {review().summary}
            </text>
          </box>
        )}
      </Show>
    </scrollbox>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/tabs/
git commit -m "feat(cli): add tab content components for agent output, plan, challenge, and review"
```

---

## Task 7: Command Input Component

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/command-input.tsx`

- [ ] **Step 1: Create the command input**

```typescript
// packages/opencode/src/devilcode/workflow-tui/command-input.tsx
import type { TextareaRenderable, KeyBinding } from "@opentui/core"
import { useTheme } from "@tui/context/theme"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { useWorkflow } from "./context"
import { isWorkflowCommand } from "./types"

export function WorkflowCommandInput() {
  const { theme } = useTheme()
  const route = useRoute()
  const toast = useToast()
  const wf = useWorkflow()

  let input: TextareaRenderable

  async function handleCommand(raw: string) {
    const trimmed = raw.trim().toLowerCase()
    if (!trimmed) return

    if (trimmed === "back") {
      route.back()
      return
    }

    if (trimmed === "status") {
      await wf.refresh()
      toast.show({ message: "State refreshed", variant: "info", duration: 2000 })
      return
    }

    if (trimmed === "pause") {
      wf.pause()
      toast.show({ message: "Paused after current wave", variant: "warning", duration: 3000 })
      return
    }

    if (trimmed === "approve") {
      if (wf.state?.currentStage === "challenge") {
        await wf.executeStage("build")
        toast.show({ message: "Plan approved — advancing to BUILD", variant: "success", duration: 3000 })
      } else {
        toast.show({ message: "Nothing to approve at this stage", variant: "warning", duration: 2000 })
      }
      return
    }

    if (trimmed === "revise") {
      if (wf.state?.currentStage === "challenge") {
        await wf.executeStage("plan")
        toast.show({ message: "Sending back for revision", variant: "info", duration: 3000 })
      }
      return
    }

    if (trimmed === "next") {
      if (!wf.state) {
        toast.show({ message: "No workflow initialized", variant: "error", duration: 2000 })
        return
      }
      // Advance to the next valid stage
      const { Workflow } = await import("../workflow")
      const next = Workflow.nextStage(wf.state.currentStage)
      await wf.executeStage(next)
      return
    }

    if (trimmed.startsWith("task ")) {
      const taskId = trimmed.slice(5).trim()
      wf.selectTask(taskId)
      return
    }

    // Check if it's a stage command
    if (isWorkflowCommand(trimmed)) {
      try {
        await wf.executeStage(trimmed as any)
      } catch (e: any) {
        toast.show({ message: e.message ?? "Stage transition failed", variant: "error", duration: 4000 })
      }
      return
    }

    // Free-text — would be sent to orchestrator as guidance
    toast.show({ message: "Sent guidance to orchestrator", variant: "info", duration: 2000 })
  }

  function submit() {
    if (!input) return
    const text = input.plainText.trim()
    if (!text) return
    input.clear()
    handleCommand(text).catch((e) => {
      toast.show({ message: String(e), variant: "error", duration: 4000 })
    })
  }

  return (
    <box
      flexDirection="row"
      height={2}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={theme.backgroundPanel}
      alignItems="center"
      gap={1}
    >
      <text fg={theme.primary} attributes={{ bold: true }}>
        workflow&gt;
      </text>
      <textarea
        ref={(r: TextareaRenderable) => {
          input = r
        }}
        placeholder="plan | build | review | ship | next | pause | back"
        textColor={theme.text}
        focusedTextColor={theme.text}
        minHeight={1}
        maxHeight={1}
        flexGrow={1}
        cursorColor={theme.text}
        focusedBackgroundColor={theme.backgroundElement}
        keyBindings={[
          { name: "return", action: "submit" } satisfies KeyBinding,
        ]}
        onSubmit={submit}
      />
    </box>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/command-input.tsx
git commit -m "feat(cli): add workflow command input with stage dispatch"
```

---

## Task 8: Main WorkflowView Component

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/index.tsx`

- [ ] **Step 1: Create the main view**

```typescript
// packages/opencode/src/devilcode/workflow-tui/index.tsx
import { useKeyboard } from "@opentui/solid"
import { useRoute } from "@tui/context/route"
import { useCommandDialog } from "@tui/component/dialog-command"
import { Toast } from "@tui/ui/toast"
import { WorkflowProvider } from "./context"
import { WorkflowStatusBar } from "./status-bar"
import { TaskPanel } from "./task-panel"
import { DetailPanel } from "./detail-panel"
import { WorkflowCommandInput } from "./command-input"

function WorkflowViewInner() {
  const route = useRoute()
  const command = useCommandDialog()

  useKeyboard((evt) => {
    if (evt.name === "escape") {
      route.back()
      evt.preventDefault()
      evt.stopPropagation()
    }
  })

  command.register(() => [
    {
      value: "workflow.back",
      title: "Exit Workflow",
      category: "Workflow",
      hidden: true,
      keybind: "escape" as any,
      onSelect: () => route.back(),
    },
  ])

  return (
    <box flexDirection="column" flexGrow={1}>
      <WorkflowStatusBar />
      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <TaskPanel />
        <box
          border={["left"]}
          borderColor={"#333333"}
          flexGrow={1}
          flexDirection="column"
          minHeight={0}
        >
          <DetailPanel />
        </box>
      </box>
      <WorkflowCommandInput />
      <Toast />
    </box>
  )
}

export function WorkflowView() {
  return (
    <WorkflowProvider>
      <WorkflowViewInner />
    </WorkflowProvider>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/index.tsx
git commit -m "feat(cli): add main WorkflowView route component with dashboard layout"
```

---

## Task 9: Route Integration (Shared File Changes)

**Files:**
- Modify: `packages/opencode/src/cli/cmd/tui/context/route.tsx`
- Modify: `packages/opencode/src/cli/cmd/tui/app.tsx`

- [ ] **Step 1: Add WorkflowRoute to route types**

Read `packages/opencode/src/cli/cmd/tui/context/route.tsx`. Find the `Route` type union (around line 5-22). Add:

```typescript
// devilcode_change start
export type WorkflowRoute = {
  type: "workflow"
  initialAction?: string
}
// devilcode_change end

// Modify the Route union to include WorkflowRoute:
// devilcode_change
export type Route = HomeRoute | SessionRoute | DevilClawRoute | WorkflowRoute
```

- [ ] **Step 2: Add WorkflowView to app.tsx route switch**

Read `packages/opencode/src/cli/cmd/tui/app.tsx`. Find the `<Switch>` block that renders routes (around line 815-826). Add a new `<Match>`:

```typescript
// At top of file, add import:
import { WorkflowView } from "@/devilcode/workflow-tui" // devilcode_change

// In the Switch block:
// devilcode_change start
<Match when={route.data.type === "workflow"}>
  <WorkflowView />
</Match>
// devilcode_change end
```

- [ ] **Step 3: Register /team command in app.tsx**

In `app.tsx`, find where `registerDevilCommands(useSDK)` is called (around line 730). Add after it:

```typescript
// devilcode_change start
import { registerWorkflowCommands } from "@/devilcode/workflow-commands"
registerWorkflowCommands()
// devilcode_change end
```

- [ ] **Step 4: Verify typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit`

- [ ] **Step 5: Commit**

```bash
git add packages/opencode/src/cli/cmd/tui/context/route.tsx packages/opencode/src/cli/cmd/tui/app.tsx
git commit -m "feat(cli): integrate WorkflowView route and register /team command"
```

---

## Task 10: Workflow Commands Registration

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-commands.tsx`

- [ ] **Step 1: Create the command registration module**

```typescript
// packages/opencode/src/devilcode/workflow-commands.tsx
import { useCommandDialog } from "@tui/component/dialog-command"
import { useRoute } from "@tui/context/route"
import { useToast } from "@tui/ui/toast"
import { WorkflowStateManager } from "./workflow/state"
import { Instance } from "@/project/instance"

export function registerWorkflowCommands() {
  const command = useCommandDialog()
  const route = useRoute()
  const toast = useToast()

  command.register(() => [
    {
      value: "workflow.open",
      title: "Team Workflow",
      description: "Open the workflow mission control dashboard",
      category: "Workflow",
      slash: { name: "team", aliases: ["workflow"] },
      onSelect: () => {
        route.navigate({ type: "workflow" })
      },
    },
    {
      value: "workflow.init",
      title: "Initialize Team Workflow",
      description: "Create .planning/ directory and start a new workflow",
      category: "Workflow",
      slash: { name: "team init" },
      onSelect: async () => {
        try {
          const manager = new WorkflowStateManager(Instance.directory)
          if (await manager.hasWorkflow()) {
            toast.show({
              message: "Workflow already initialized. Use /team to open.",
              variant: "info",
              duration: 3000,
            })
            route.navigate({ type: "workflow" })
            return
          }
          const projectName = Instance.directory.split(/[/\\]/).pop() ?? "project"
          await manager.initialize(projectName)
          toast.show({
            message: "Workflow initialized. Opening dashboard...",
            variant: "success",
            duration: 3000,
          })
          route.navigate({ type: "workflow" })
        } catch (e: any) {
          toast.show({
            message: "Failed to initialize: " + (e.message ?? String(e)),
            variant: "error",
            duration: 5000,
          })
        }
      },
    },
  ])
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-commands.tsx
git commit -m "feat(cli): add /team and /team init slash command registration"
```

---

## Task 11: Orchestrator Bridge

**Files:**
- Create: `packages/opencode/src/devilcode/workflow-tui/orchestrator.ts`

- [ ] **Step 1: Create the orchestrator module**

This bridges the view to the workflow engine. It manages the root session and dispatches stage-appropriate actions. This is a simplified initial version — full agent dispatch integration will be refined as the SSE streaming is tested end-to-end.

```typescript
// packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { groupByWave, validateWaveIntegrity, detectFileConflicts } from "../workflow/executor"
import { triageFindings, routeFix, MAX_REVIEW_CYCLES } from "../workflow/reviewer"
import type { WorkflowStage, PlanTask, ReviewFinding } from "../workflow/types"
import type { TeamConfig } from "../team/config"
import { Instance } from "@/project/instance"

export class WorkflowOrchestrator {
  private manager: WorkflowStateManager

  constructor() {
    this.manager = new WorkflowStateManager(Instance.directory)
  }

  async initialize(projectName: string): Promise<void> {
    await this.manager.initialize(projectName)
  }

  async hasWorkflow(): Promise<boolean> {
    return this.manager.hasWorkflow()
  }

  async getManager(): Promise<WorkflowStateManager> {
    return this.manager
  }

  async validateBuild(): Promise<{ valid: boolean; errors: string[] }> {
    const state = await this.manager.readState()
    if (!state.currentPhase) return { valid: false, errors: ["No current phase set"] }

    const plans = await this.manager.readAllPlans(state.currentPhase)
    if (plans.length === 0) return { valid: false, errors: ["No plan tasks found"] }

    const integrityErrors = validateWaveIntegrity(plans)
    const conflicts = detectFileConflicts(plans)
    const allErrors = [...integrityErrors, ...conflicts]

    return { valid: allErrors.length === 0, errors: allErrors }
  }

  async getWaves(): Promise<Map<number, PlanTask[]>> {
    const state = await this.manager.readState()
    if (!state.currentPhase) return new Map()
    const plans = await this.manager.readAllPlans(state.currentPhase)
    return groupByWave(plans)
  }

  async advanceStage(stage: WorkflowStage): Promise<void> {
    await Workflow.advanceStage(this.manager, stage)
  }

  async triageReview(): Promise<{
    blockers: ReviewFinding[]
    warnings: ReviewFinding[]
    suggestions: ReviewFinding[]
    needsFixes: boolean
  }> {
    const state = await this.manager.readState()
    if (!state.currentPhase) throw new Error("No current phase")

    const review = await this.manager.readReview(state.currentPhase)
    const { blockers, warnings, suggestions } = triageFindings(review.findings)

    return {
      blockers,
      warnings,
      suggestions,
      needsFixes: blockers.length > 0 && review.cycle < MAX_REVIEW_CYCLES,
    }
  }

  async getFixRouting(
    findings: ReviewFinding[],
    teamConfig: TeamConfig,
  ): Promise<Map<string, ReviewFinding[]>> {
    const routing = new Map<string, ReviewFinding[]>()
    for (const finding of findings) {
      const role = routeFix(finding, teamConfig)
      const existing = routing.get(role) ?? []
      existing.push(finding)
      routing.set(role, existing)
    }
    return routing
  }
}

let instance: WorkflowOrchestrator | undefined

export function getOrchestrator(): WorkflowOrchestrator {
  if (!instance) {
    instance = new WorkflowOrchestrator()
  }
  return instance
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/opencode/src/devilcode/workflow-tui/orchestrator.ts
git commit -m "feat(cli): add WorkflowOrchestrator bridge between TUI and workflow engine"
```

---

## Task 12: End-to-End Verification

**Files:** None new — verification only.

- [ ] **Step 1: Run all team and workflow tests**

Run: `cd packages/opencode && bun test test/kilocode/team/ test/kilocode/workflow/`
Expected: All 81 tests pass

- [ ] **Step 2: Run typecheck**

Run: `cd packages/opencode && bunx tsgo --noEmit`
Expected: No new errors from our changes

- [ ] **Step 3: Verify route type is correct**

Run: `cd packages/opencode && bun -e "console.log('Route types compile OK')"`
This confirms the TypeScript compilation works with the new route type.

- [ ] **Step 4: Verify the file structure**

Run: `ls -la packages/opencode/src/devilcode/workflow-tui/` and `ls -la packages/opencode/src/devilcode/workflow-tui/tabs/`

Expected files:
```
workflow-tui/
├── index.tsx
├── status-bar.tsx
├── task-panel.tsx
├── detail-panel.tsx
├── command-input.tsx
├── orchestrator.ts
├── types.ts
├── context.tsx
└── tabs/
    ├── tab-bar.tsx
    ├── agent-output-tab.tsx
    ├── plan-tab.tsx
    ├── challenge-tab.tsx
    └── review-tab.tsx
```

Plus: `packages/opencode/src/devilcode/workflow-commands.tsx`

- [ ] **Step 5: Final commit if any cleanup needed**

```bash
git status
# If clean, no commit needed
```
