import type { ProjectSessionInfo } from "../../src/types/messages"
import { isKnownRootSession } from "../navigate"

export function rootSessions(sessions: ProjectSessionInfo[], worktreeId: string | null): ProjectSessionInfo[] {
  return sessions.filter((session) => session.worktreeId === worktreeId && isKnownRootSession(session))
}
