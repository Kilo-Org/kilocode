/**
 * The session the sidebar chat is showing. The sidebar and the Agent Manager share one browser broker, and a session
 * can exist in both surfaces: the sidebar reports its session here so the editor tab claims it and the panel does not.
 */
let current: string | undefined

export function setSidebarSession(sessionId: string | undefined): void {
  current = sessionId
}

export function sidebarSession(): string | undefined {
  return current
}