import type { ProjectStore } from "./store"
import type { ExtensionMessage } from "../../src/types/messages"

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
