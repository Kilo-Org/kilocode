import type { ProjectStore } from "./store"
import type { AgentManagerWorktreeSetupMessage, ExtensionMessage } from "../../src/types/messages"

export interface SetupState {
  active: boolean
  message: string
  branch?: string
  error?: boolean
  worktreeId?: string
  errorCode?: string
  projectId?: string
  selection?: string | null
}

export function setupVisible(state: SetupState, project: string | undefined, selection: string | null): boolean {
  return state.active && state.projectId === project && (state.worktreeId ?? state.selection) === selection
}

export function updateSetup(
  store: ProjectStore,
  state: SetupState,
  msg: AgentManagerWorktreeSetupMessage,
  project: string | undefined,
  selection: string | null,
): SetupState {
  const owner = msg.projectId ?? project
  const current = owner === project
  const same = state.active && state.projectId === owner
  const done = msg.status === "ready" || msg.status === "error"
  const id = msg.worktreeId ?? (done && same ? state.worktreeId : undefined)
  const matches = same && state.worktreeId === id
  if (id) {
    store.setBusy((prev) => {
      const next = new Map(prev)
      if (done) next.delete(id)
      else next.set(id, { reason: "setting-up", message: msg.message, branch: msg.branch })
      return next
    })
  }
  if (!current && !same) return state
  if (!matches && (done ? state.active : !current && !!state.worktreeId)) return state
  return {
    active: !done || (current && msg.status === "error"),
    message: msg.message,
    branch: msg.branch,
    error: msg.status === "error",
    errorCode: msg.errorCode,
    worktreeId: id,
    projectId: owner,
    selection: id ? undefined : matches ? state.selection : selection,
  }
}

export function clearFailedDelete(
  msg: ExtensionMessage,
  stores: { ensure: (id: string) => ProjectStore; active: () => ProjectStore },
): void {
  if (msg.type !== "error" || msg.code !== "agentManager.worktreeDeleteFailed" || !msg.worktreeId) return
  const store = msg.projectId ? stores.ensure(msg.projectId) : stores.active()
  store.setBusy((prev) => new Map([...prev].filter(([id]) => id !== msg.worktreeId)))
}

/** Clear setup indicators for every worktree in one multi-version group. */
export function clearMultiVersionBusy(store: ProjectStore, groupId: string): void {
  const ids = new Set(
    store
      .worktrees()
      .filter((wt) => wt.groupId === groupId)
      .map((wt) => wt.id),
  )
  if (ids.size === 0) return
  store.setBusy((prev) => new Map([...prev].filter(([id, busy]) => !ids.has(id) || busy.reason === "deleting")))
}

/** Keep a newly created grouped worktree showing progress until its prompt starts. */
export function markMultiVersionBusy(store: ProjectStore, sessionId: string): void {
  const session = store.managedSessions().find((item) => item.id === sessionId)
  const id = session?.worktreeId
  if (!id) return
  const worktree = store.worktrees().find((item) => item.id === id)
  if (!worktree?.groupId) return
  store.setBusy((prev) => {
    if (prev.get(id)?.reason === "deleting") return prev
    return new Map([...prev, [id, { reason: "setting-up" as const }]])
  })
}
