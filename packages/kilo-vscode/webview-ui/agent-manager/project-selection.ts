import type { ExtensionMessage, ManagedSessionState } from "../src/types/messages"

export function applyProjectSelection(
  msg: ExtensionMessage,
  deps: {
    active: (projectId: string) => boolean
    managed: (projectId: string) => ManagedSessionState[]
    local: (projectId: string) => void
    worktree: (projectId: string, worktreeId: string) => void
    session: (sessionId: string) => void
    openTab: (sessionId: string) => void
    managedSession: (worktreeId: string, sessionId: string) => void
  },
): boolean {
  if (msg.type !== "agentManager.selectionActivated") return false
  const target = msg.target
  // A selection acknowledgement can arrive after the user switched again.
  // Ignore it unless this project's catalog entry and state are both active.
  if (!deps.active(target.projectId)) return true
  // Scope by project like the session branch: a selection ack must never act on
  // another project's data if it lands before that project's state push.
  if (target.kind === "local") deps.local(target.projectId)
  if (target.kind === "worktree") deps.worktree(target.projectId, target.worktreeId)
  if (target.kind === "session") {
    const session = deps.managed(target.projectId).find((item) => item.id === target.sessionId)
    if (session?.worktreeId) deps.managedSession(session.worktreeId, target.sessionId)
    else {
      // An unassigned session joins the project's local tabs, mirroring what
      // selecting it from the legacy sidebar does, before it becomes current.
      deps.openTab(target.sessionId)
      deps.local(target.projectId)
      deps.session(target.sessionId)
    }
  }
  return true
}
