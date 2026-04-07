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
