import type { ManagedSessionState, ProjectSessionInfo, SessionInfo } from "../../src/types/messages/agent-manager"
import { isKnownRootSession, showsSession } from "../navigate"
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
  closed: ReadonlySet<string> = new Set(),
) {
  const ids = worktreeSessionIds(id, managed)
  return applyTabOrder(
    sessions
      .filter((session) => !closed.has(session.id) && isKnownRootSession(session) && ids.has(session.id))
      .sort((a, b) => a.time.created - b.time.created),
    order,
  )
}

/**
 * The tabs of one worktree.
 *
 * Managed sessions and loaded live sessions decide membership. The tab order also names a session the host has not
 * stamped yet, such as one just created here, so the owner check keeps a session that runs in another directory out.
 * A session the user closed is hidden at once, before the host state drops it.
 */
export function worktreeSessionTabs(input: {
  id: string
  managed: ManagedSessionState[]
  sessions: SessionInfo[]
  order: string[] | undefined
  lookup: (id: string) => SessionInfo | undefined
  owner: (id: string) => string | null | undefined
  closed?: ReadonlySet<string>
}): SessionInfo[] {
  const order = input.order?.filter((id) => !input.closed?.has(id))
  const list = worktreeSessions(input.id, input.managed, input.sessions, order, input.closed).filter((session) =>
    showsSession(input.id, input.owner(session.id)),
  )
  const known = new Set(list.map((session) => session.id))
  const extra = (order ?? []).flatMap((sessionID) => {
    const session = input.lookup(sessionID)
    if (!session || known.has(sessionID) || !isKnownRootSession(session)) return []
    return showsSession(input.id, input.owner(sessionID)) ? [session] : []
  })
  return extra.length > 0 ? applyTabOrder([...list, ...extra], order) : list
}
