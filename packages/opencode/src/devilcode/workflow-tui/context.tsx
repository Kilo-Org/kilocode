// packages/opencode/src/devilcode/workflow-tui/context.tsx
import { createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { onMount, onCleanup } from "solid-js"
import type { WorkflowState, PlanTask, PlanChallenge, ReviewVerdict, WorkflowStage, TaskResult } from "../workflow/types"
import type { TabInfo, SessionInfo } from "./types"
import type { TeamConfig } from "../team/config"
import { WorkflowStateManager } from "../workflow/state"
import { Workflow } from "../workflow"
import { SessionBridge } from "../workflow/session-bridge"
import { getOrchestrator } from "./orchestrator"
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
  closeTab(tabId: string): void
  addAgentTab(info: TabInfo): void
  startBuild(teamConfig: TeamConfig | undefined): Promise<TaskResult[]>
  dispatchStage(
    stage: WorkflowStage,
    modelInfo: { providerID: string; modelID: string },
    options?: {
      phaseContext?: string
      teamConfig?: TeamConfig
      diff?: string
    },
  ): Promise<void>
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

    async startBuild(teamConfig: TeamConfig | undefined) {
      setStore("executing", true)
      const orchestrator = getOrchestrator()

      try {
        const results = await orchestrator.executeBuild(
          {
            onTaskStart: (taskId, sessionId) => {
              setStore(
                produce((s) => {
                  s.activeSessions[sessionId] = {
                    sessionId,
                    taskId,
                    role: "worker",
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
              const entry = Object.values(store.activeSessions).find(
                (s) => s.taskId === taskId,
              )
              if (entry) {
                setStore(
                  produce((s) => {
                    const session = s.activeSessions[entry.sessionId]
                    if (session) {
                      session.status = result.status === "completed" ? "completed" : "failed"
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
      modelInfo: { providerID: string; modelID: string },
      options?: {
        phaseContext?: string
        teamConfig?: TeamConfig
        diff?: string
      },
    ) {
      setStore("executing", true)
      const orchestrator = getOrchestrator()

      try {
        switch (stage) {
          case "plan": {
            const roles = options?.teamConfig
              ? Object.keys(options.teamConfig.roles)
              : ["senior", "worker"]
            await orchestrator.executePlan({
              ...modelInfo,
              phaseContext: options?.phaseContext ?? "",
              availableRoles: roles,
            })
            break
          }
          case "challenge": {
            await orchestrator.executeChallenge({
              ...modelInfo,
              phaseContext: options?.phaseContext ?? "",
            })
            break
          }
          case "contract": {
            await orchestrator.executeContracts()
            break
          }
          case "build": {
            await value.startBuild(options?.teamConfig)
            break
          }
          case "review": {
            await orchestrator.executeReview({
              ...modelInfo,
              diff: options?.diff ?? "",
              cycle: store.review ? store.review.cycle + 1 : 1,
            })
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
