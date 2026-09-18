import type { ManagedSessionState, ProjectSessionInfo, SessionInfo } from "../../src/types/messages"
import { isKnownRootSession } from "../navigate"
import { applyTabOrder } from "../tab-order"

export function rootSessions(sessions: ProjectSessionInfo[], worktreeId: string | null): ProjectSessionInfo[] {
  return sessions.filter((session) => session.worktreeId === worktreeId && isKnownRootSession(session))
}

export function worktreeSessionIds(id: string, sessions: ManagedSessionState[]) {
  return new Set(sessions.filter((session) => session.worktreeId === id).map((session) => session.id))
}

export function worktreeSessions(
  id: string,
  managed: ManagedSessionState[],
  sessions: SessionInfo[],
  order: string[] | undefined,
) {
  const ids = worktreeSessionIds(id, managed)
  return applyTabOrder(
    sessions
      .filter((session) => isKnownRootSession(session) && ids.has(session.id))
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()),
    order,
  )
}
