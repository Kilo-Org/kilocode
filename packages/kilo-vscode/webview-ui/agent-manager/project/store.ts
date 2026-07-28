import { createSignal, type Accessor, type Setter } from "solid-js"
import type {
  AgentManagerApplyWorktreeDiffConflict,
  AgentManagerApplyWorktreeDiffStatus,
  LocalGitStats,
  ManagedSessionState,
  PRStatus,
  RunStatus,
  SectionState,
  WorktreeGitStats,
  WorktreeState,
} from "../../src/types/messages"

export interface WorktreeBusyState {
  reason: "setting-up" | "deleting"
  message?: string
  branch?: string
}

export interface ApplyState {
  status: AgentManagerApplyWorktreeDiffStatus
  message: string
  conflicts: AgentManagerApplyWorktreeDiffConflict[]
}

/** Local session tab ids owned by one project. */
export function createStoreTabs(initial: string[] = []) {
  const [ids, setIds] = createSignal<string[]>(initial)
  const set = (next: string[] | ((prev: string[]) => string[])) => {
    const cur = ids()
    const value = typeof next === "function" ? next(cur) : next
    if (value !== cur) setIds(value)
  }
  /** Ids safe to persist (ephemeral pending drafts removed). */
  const durable = (pending: (id: string) => boolean) => ids().filter((id) => !pending(id))
  return { ids, set, durable }
}

function field<T>(initial: T): [Accessor<T>, Setter<T>] {
  const [get, set] = createSignal<T>(initial)
  return [get, set]
}

/**
 * Per-project state that must never be shared with other projects: sidebar
 * inventory (worktrees, sessions, sections, orders), live data (stats, PR and
 * run statuses, apply/busy state), local session tabs, and per-context tab
 * memory. Worktree ids and the "local" context collide across projects, so
 * every keyed collection here is safe only because each project owns one.
 */
export function createProjectStore(id: string, opts: { tabs?: string[] } = {}) {
  const tabs = createStoreTabs(opts.tabs)

  /** Last visible tab per sidebar context ("local" or a worktree id). */
  const [memory, setMemory] = createSignal<Record<string, string>>({})
  const tabMemory = {
    all: memory,
    get: (sel: string) => memory()[sel],
    set: (sel: string, tab: string) => setMemory((prev) => (prev[sel] === tab ? prev : { ...prev, [sel]: tab })),
  }

  const [worktrees, setWorktrees] = field<WorktreeState[]>([])
  const [managedSessions, setManagedSessions] = field<ManagedSessionState[]>([])
  const [sections, setSections] = field<SectionState[]>([])
  const [staleWorktreeIds, setStaleWorktreeIds] = field<Set<string>>(new Set())
  const [tabOrder, setTabOrder] = field<Record<string, string[]>>({})
  const [worktreeOrder, setWorktreeOrder] = field<string[]>([])
  const [sessionsCollapsed, setSessionsCollapsed] = field<boolean | undefined>(undefined)
  const [defaultBaseBranch, setDefaultBaseBranch] = field<string | undefined>(undefined)
  const [runScriptConfigured, setRunScriptConfigured] = field(false)
  const [prStatuses, setPrStatuses] = field<Record<string, PRStatus | null>>({})
  const [runStatuses, setRunStatuses] = field<Record<string, RunStatus>>({})
  const [worktreeStats, setWorktreeStats] = field<Record<string, WorktreeGitStats>>({})
  const [localStats, setLocalStats] = field<LocalGitStats | undefined>(undefined)
  const [applyStates, setApplyStates] = field<Record<string, ApplyState>>({})
  const [busy, setBusy] = field<Map<string, WorktreeBusyState>>(new Map())

  return {
    id,
    tabs,
    tabMemory,
    worktrees,
    setWorktrees,
    managedSessions,
    setManagedSessions,
    sections,
    setSections,
    staleWorktreeIds,
    setStaleWorktreeIds,
    tabOrder,
    setTabOrder,
    worktreeOrder,
    setWorktreeOrder,
    sessionsCollapsed,
    setSessionsCollapsed,
    defaultBaseBranch,
    setDefaultBaseBranch,
    runScriptConfigured,
    setRunScriptConfigured,
    prStatuses,
    setPrStatuses,
    runStatuses,
    setRunStatuses,
    worktreeStats,
    setWorktreeStats,
    localStats,
    setLocalStats,
    applyStates,
    setApplyStates,
    busy,
    setBusy,
  }
}

export type ProjectStore = ReturnType<typeof createProjectStore>
