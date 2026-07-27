import type { ExtensionMessage, ManagedSessionState } from "../src/types/messages"

export function applyProjectSelection(
  msg: ExtensionMessage,
  deps: {
    managed: (projectId: string) => ManagedSessionState[]
    local: () => void
    worktree: (worktreeId: string) => void
    session: (sessionId: string) => void
    managedSession: (worktreeId: string, sessionId: string) => void
  },
): boolean {
  if (msg.type !== "agentManager.selectionActivated") return false
  const target = msg.target
  if (target.kind === "local") deps.local()
  if (target.kind === "worktree") deps.worktree(target.worktreeId)
  if (target.kind === "session") {
    const session = deps.managed(target.projectId).find((item) => item.id === target.sessionId)
    if (session?.worktreeId) deps.managedSession(session.worktreeId, target.sessionId)
    else {
      deps.local()
      deps.session(target.sessionId)
    }
  }
  return true
}
