// packages/opencode/src/devilcode/workflow-tui/context.tsx
import { createContext, useContext, createEffect, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { onMount, onCleanup } from "solid-js"
import type {
  WorkflowState,
  PlanTask,
  PlanChallenge,
  ReviewVerdict,
  WorkflowStage,
  TaskResult,
  ShipReport,
  RetroReport,
} from "../workflow/types"
import type { TabInfo, SessionInfo, DensityMode } from "./types"
import type { CanonicalTeamConfig as TeamConfig } from "../team/config"
import { Config } from "../../config/config"
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { SessionBridge } from "../workflow/session-bridge"
import { getOrchestrator } from "./orchestrator"
import type { HealthAlert, DeadlockResult } from "../workflow/health"
import type { WorkflowEvent } from "../workflow/events"

export type WorkflowViewState = {
  state: WorkflowState | undefined
  plans: PlanTask[]
  challenge: PlanChallenge | undefined
  review: ReviewVerdict | undefined
  ship: ShipReport | undefined
  retro: RetroReport | undefined
  summaries: Record<string, string>

  selectedTask: string | undefined
  activeTab: string
  tabs: TabInfo[]

  executing: boolean
  pauseRequested: boolean
  activeSessions: Record<string, SessionInfo>
  rootSessionId: string | undefined

  healthAlerts: HealthAlert[]
  deadlock: DeadlockResult | null
  events: WorkflowEvent[]

  density: DensityMode
  firstRunComplete: boolean

  // Actions
  setDensity(mode: DensityMode): Promise<void>
  markFirstRunComplete(): Promise<void>
  refresh(): Promise<void>
  executeStage(stage: WorkflowStage): Promise<void>
  selectTask(taskId: string): void
  switchTab(tabId: string): void
  closeTab(tabId: string): void
  addAgentTab(info: TabInfo): void
  startBuild(teamConfig: TeamConfig | undefined): Promise<TaskResult[]>
  dispatchStage(
    stage: WorkflowStage,
    modelInfo?: { providerID: string; modelID: string },
    options?: {
      phaseContext?: string
      teamConfig?: TeamConfig
      diff?: string
    },
  ): Promise<void>
  updateSessionOutput(sessionId: string, line: string): void
  setSessionStatus(sessionId: string, status: SessionInfo["status"]): void
  pause(): boolean
  setExecuting(value: boolean): void
}

const WorkflowCtx = createContext<WorkflowViewState>()

export function WorkflowProvider(props: ParentProps & { directory: string }) {
  const manager = new WorkflowStateManager(props.directory)

  const [store, setStore] = createStore<{
    state: WorkflowState | undefined
    plans: PlanTask[]
    challenge: PlanChallenge | undefined
    review: ReviewVerdict | undefined
    ship: ShipReport | undefined
    retro: RetroReport | undefined
    summaries: Record<string, string>
    selectedTask: string | undefined
    activeTab: string
    tabs: TabInfo[]
    executing: boolean
    pauseRequested: boolean
    activeSessions: Record<string, SessionInfo>
    rootSessionId: string | undefined
    healthAlerts: HealthAlert[]
    deadlock: DeadlockResult | null
    events: WorkflowEvent[]
    density: DensityMode
    firstRunComplete: boolean
  }>({
    state: undefined,
    plans: [],
    challenge: undefined,
    review: undefined,
    ship: undefined,
    retro: undefined,
    summaries: {},
    selectedTask: undefined,
    activeTab: "plan",
    tabs: [
      { id: "plan", label: "Plan", kind: "plan" as const, closeable: false },
      { id: "activity", label: "Activity", kind: "activity" as const, closeable: false },
    ],
    executing: false,
    pauseRequested: false,
    activeSessions: {},
    rootSessionId: undefined,
    healthAlerts: [],
    deadlock: null,
    events: [],
    density: "expanded" as DensityMode,
    firstRunComplete: false,
  })

  const bridge = new SessionBridge({
    onOutput(sessionId, taskId, line) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.output.push(line)
          }
        }),
      )
    },
    onStatusChange(sessionId, status) {
      setStore(
        produce((s) => {
          const session = s.activeSessions[sessionId]
          if (session) {
            session.status = status
          }
        }),
      )
    },
  })

  onCleanup(() => bridge.unwatchAll())

  async function refresh() {
    try {
      if (!(await manager.hasWorkflow())) return
      const state = await manager.readState()
      setStore("state", state)

      if (state.currentPhase) {
        const plans = await manager.readAllPlans(state.currentPhase).catch(() => [])
        setStore("plans", plans)
        setStore("selectedTask", (current) =>
          current && plans.find((plan) => plan.id === current)
            ? current
            : plans[0]?.id,
        )

        const challenge = await manager.readChallenge(state.currentPhase).catch(() => undefined)
        setStore("challenge", challenge)
        if (challenge && !store.tabs.find((tab) => tab.id === "challenge")) {
          setStore("tabs", (tabs) => [
            ...tabs,
            { id: "challenge", label: "Challenge", kind: "challenge" as const, closeable: false },
          ])
        }

        const review = await manager.readReview(state.currentPhase).catch(() => undefined)
        setStore("review", review)
        if (review && !store.tabs.find((tab) => tab.id === "review")) {
          setStore("tabs", (tabs) => [
            ...tabs,
            { id: "review", label: "Review", kind: "review" as const, closeable: false },
          ])
        }

        setStore("ship", await manager.readShip(state.currentPhase).catch(() => undefined))
        setStore("retro", await manager.readRetro(state.currentPhase).catch(() => undefined))

        const summaries = await Promise.all(
          plans.map(async (plan) => {
            const summary = await manager.readSummary(state.currentPhase!, plan.id).catch(() => "")
            return [plan.id, summary] as const
          }),
        )
        setStore("summaries", Object.fromEntries(summaries.filter((entry) => entry[1])))
      } else {
        setStore("plans", [])
        setStore("challenge", undefined)
        setStore("review", undefined)
        setStore("ship", undefined)
        setStore("retro", undefined)
        setStore("summaries", {})
        setStore("selectedTask", undefined)
      }

      // Poll health during active execution
      if (store.executing && state.activeTasks.length > 0) {
        const orchestrator = getOrchestrator(props.directory)
        const health = orchestrator.checkHealth(state.activeTasks, store.plans)
        setStore("healthAlerts", health.stuckAlerts)
        setStore("deadlock", health.deadlock)
      } else {
        setStore("healthAlerts", [])
        setStore("deadlock", null)
      }

      // Load recent events for the activity tab
      try {
        const orchestrator = getOrchestrator(props.directory)
        const events = await orchestrator.getEventLogger().readRecent(50)
        setStore("events", events)
      } catch {
        // events not available yet
      }
    } catch {
      // .planning/ not initialized
    }
  }

  // Named handlers defined before createEffect to avoid TDZ (R3-06)
  async function handleSetDensity(mode: DensityMode): Promise<void> {
    setStore("density", mode)
    try {
      const current = await Config.get()
      await Config.update({
        ...current,
        workflow: { ...(current.workflow ?? {}), density: mode },
      })
    } catch {
      // Persistence failure does not revert UI state
    }
  }

  async function handleMarkFirstRunComplete(): Promise<void> {
    setStore("firstRunComplete", true)
    try {
      const current = await Config.get()
      await Config.update({
        ...current,
        workflow: { ...(current.workflow ?? {}), firstRunComplete: true },
      })
    } catch {}
  }

  // Auto-compact fires once per session when the first build task completes
  let autoCompactFired = false
  createEffect(() => {
    if (autoCompactFired) return
    if (!store.firstRunComplete) return
    if (store.density !== "expanded") return
    const state = store.state
    if (!state) return
    const anyCompleted = state.activeTasks.some((t) => t.status === "completed")
    if (anyCompleted) {
      autoCompactFired = true
      void handleSetDensity("compact")
      // Also persist the autoCompactFired flag across sessions (R3-05)
      void (async () => {
        try {
          const cfg = await Config.get()
          await Config.update({ ...cfg, workflow: { ...(cfg.workflow ?? {}), autoCompactFired: true } })
        } catch {}
      })()
    }
  })

  onMount(async () => {
    // Bootstrap density + firstRunComplete from persisted Config (R3-05)
    try {
      const cfg = await Config.get()
      setStore("density", cfg.workflow?.density ?? "expanded")
      setStore("firstRunComplete", Boolean(cfg.workflow?.firstRunComplete))
      autoCompactFired = Boolean(cfg.workflow?.autoCompactFired)
    } catch {
      // Config not initialized yet — keep defaults
    }
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
    get ship() {
      return store.ship
    },
    get retro() {
      return store.retro
    },
    get summaries() {
      return store.summaries
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
    get pauseRequested() {
      return store.pauseRequested
    },
    get activeSessions() {
      return store.activeSessions
    },
    get rootSessionId() {
      return store.rootSessionId
    },
    get healthAlerts() {
      return store.healthAlerts
    },
    get deadlock() {
      return store.deadlock
    },
    get events() {
      return store.events
    },
    get density() {
      return store.density
    },
    get firstRunComplete() {
      return store.firstRunComplete
    },

    setDensity: handleSetDensity,
    markFirstRunComplete: handleMarkFirstRunComplete,

    refresh,

    async executeStage(stage: WorkflowStage) {
      setStore("executing", true)
      try {
        const orchestrator = getOrchestrator(props.directory)

        // Run preflight checks before the plan stage
        if (stage === "plan") {
          const report = await orchestrator.runPreflight()
          const { preflightPassed: passed, reportSummary: summary } = await import("../workflow/preflight")
          if (!passed(report)) {
            const msg = summary(report)
            throw new Error(`Preflight failed: ${msg}. Fix the errors above before planning.`)
          }
        }

        await Workflow.advanceStage(manager, stage)
        await refresh()
      } catch (e) {
        setStore("executing", false)
        throw e
      }
      setStore("executing", false)
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

    closeTab(tabId: string) {
      const tab = store.tabs.find((t) => t.id === tabId)
      if (!tab || !tab.closeable) return
      const currentIndex = store.tabs.findIndex((t) => t.id === tabId)
      setStore("tabs", (tabs) => tabs.filter((t) => t.id !== tabId))
      if (store.activeTab === tabId) {
        const remaining = store.tabs.filter((t) => t.id !== tabId)
        const nextIndex = Math.min(currentIndex, remaining.length - 1)
        const nextTab = remaining[nextIndex] ?? remaining[0]
        if (nextTab) {
          setStore("activeTab", nextTab.id)
        }
      }
    },

    addAgentTab(info: TabInfo) {
      setStore("tabs", (tabs) => {
        const idx = tabs.findIndex((tab) => tab.id === info.id)
        if (idx < 0) return [...tabs, info]
        return tabs.map((tab, pos) => (pos === idx ? info : tab))
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
      const paused = getOrchestrator(props.directory).pauseBuild()
      if (paused) {
        setStore("pauseRequested", true)
      }
      return paused
    },

    setExecuting(value: boolean) {
      setStore("executing", value)
      if (!value) {
        setStore("pauseRequested", false)
      }
    },

    async startBuild(teamConfig: TeamConfig | undefined) {
      setStore("executing", true)
      setStore("pauseRequested", false)
      setStore(
        produce((s) => {
          if (!s.state) return
          const prior = new Map(s.state.activeTasks.map((task) => [task.id, task.status]))
          s.state.totalWaves = new Set(store.plans.map((plan) => plan.wave)).size
          s.state.activeTasks = store.plans.map((plan) => ({
            id: plan.id,
            role: plan.role,
            status: prior.get(plan.id) === "completed" ? "completed" : "pending",
          }))
        }),
      )
      const orchestrator = getOrchestrator(props.directory)

      try {
        const results = await orchestrator.executeBuild(
          {
            onWaveStart: (wave, total) => {
              setStore(
                produce((s) => {
                  if (!s.state) return
                  s.state.activeWave = wave
                  s.state.totalWaves = total
                }),
              )
            },
            onPause: () => {
              setStore("pauseRequested", false)
            },
            onTaskStart: (taskId, sessionId) => {
              setStore(
                produce((s) => {
                  if (!s.state) return
                  const task = s.state.activeTasks.find((entry) => entry.id === taskId)
                  if (task) {
                    task.status = "in_progress"
                  }
                }),
              )
              // devilcode_change - audit MA9: derive role from the actual task instead of hardcoding "worker".
              const taskForSession = store.plans.find((p) => p.id === taskId)
              setStore(
                produce((s) => {
                  s.activeSessions[sessionId] = {
                    sessionId,
                    taskId,
                    role: taskForSession?.role ?? "unknown",
                    status: "running",
                    output: [],
                  }
                }),
              )
              const task = store.plans.find((p) => p.id === taskId)
              value.addAgentTab({
                id: `agent-${taskId}`,
                label: task?.title ?? taskId,
                kind: "agent",
                sessionId,
                taskId,
                closeable: true,
              })
              bridge.watch(sessionId, taskId)
            },
            onTaskComplete: (taskId, result) => {
              setStore(
                produce((s) => {
                  if (!s.state) return
                  const task = s.state.activeTasks.find((entry) => entry.id === taskId)
                  if (task) {
                    task.status = result.status
                  }
                }),
              )
              const entry = Object.values(store.activeSessions).find(
                (s) => s.taskId === taskId,
              )
              if (entry) {
                setStore(
                  produce((s) => {
                    const session = s.activeSessions[entry.sessionId]
                    if (session) {
                      session.status = result.status === "completed"
                        ? "completed"
                        : result.status === "escalated"
                          ? "escalated"
                          : "failed"
                    }
                  }),
                )
              }
            },
            onOutput: (taskId, sessionId, line) => {
              setStore(
                produce((s) => {
                  const session = s.activeSessions[sessionId]
                  if (session) {
                    session.output.push(line)
                  }
                }),
              )
            },
          },
          teamConfig,
        )

        await refresh()
        return results
      } finally {
        setStore("executing", false)
        bridge.unwatchAll()
      }
    },

    async dispatchStage(
      stage: WorkflowStage,
      modelInfo?: { providerID: string; modelID: string },
      options?: {
        phaseContext?: string
        teamConfig?: TeamConfig
        diff?: string
      },
    ) {
      setStore("executing", true)
      const orchestrator = getOrchestrator(props.directory)
      const info = () => {
        if (!modelInfo) {
          throw new Error(`The ${stage} stage requires a selected model.`)
        }
        return modelInfo
      }

      try {
        switch (stage) {
          case "plan": {
            const report = await orchestrator.runPreflight()
            const { preflightPassed: passed, reportSummary: summary } = await import("../workflow/preflight")
            if (!passed(report)) {
              const msg = summary(report)
              throw new Error(`Preflight failed: ${msg}. Fix the errors above before planning.`)
            }
            if (store.state?.currentStage !== "plan") {
              await Workflow.advanceStage(manager, "plan")
            }
            // devilcode_change - audit MA9: derive role list from team config; surface explicit
            // error when no team configured rather than silently defaulting to "senior"/"worker".
            const roles = options?.teamConfig ? Object.keys(options.teamConfig.roles) : []
            if (roles.length === 0) {
              throw new Error(
                "No team roles available — configure `team.roles` in devilcode config before running plan dispatch.",
              )
            }
            await orchestrator.executePlan({
              ...info(),
              phaseContext: options?.phaseContext ?? "",
              availableRoles: roles,
            })
            break
          }
          case "challenge": {
            const result = await orchestrator.executeChallenge({
              ...info(),
              phaseContext: options?.phaseContext ?? "",
            })
            if (store.state?.currentStage !== "challenge") {
              await Workflow.advanceStage(manager, "challenge")
            }
            if (result) {
              setStore("activeTab", "challenge")
            }
            break
          }
          case "contract": {
            if (store.state?.currentStage !== "contract") {
              await Workflow.advanceStage(manager, "contract")
            }
            await orchestrator.executeContracts()
            break
          }
          case "build": {
            if (store.state?.currentStage !== "build") {
              await Workflow.advanceStage(manager, "build")
              await refresh()
            }
            await value.startBuild(options?.teamConfig)
            break
          }
          case "review": {
            const diff = options?.diff
            if (!diff) {
              throw new Error("Review requires a diff. Run `git diff` against the base branch and pass the result.")
            }
            await orchestrator.executeReview({
              ...info(),
              diff,
              cycle: store.review ? store.review.cycle + 1 : 1,
            })
            if (store.state?.currentStage !== "review") {
              await Workflow.advanceStage(manager, "review")
            }
            setStore("activeTab", "review")
            break
          }
          case "ship": {
            const ship = await orchestrator.executeShip()
            if (ship.status !== "ready") {
              await refresh()
              throw new Error(ship.summary)
            }
            if (store.state?.currentStage !== "ship") {
              await Workflow.advanceStage(manager, "ship")
            }
            break
          }
          case "retro": {
            await orchestrator.executeRetro()
            if (store.state?.currentStage !== "retro") {
              await Workflow.advanceStage(manager, "retro")
            }
            break
          }
        }
        await refresh()
      } finally {
        setStore("executing", false)
      }
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
