/**
 * The session the sidebar chat is showing. The sidebar and the Agent Manager share one browser broker, and a session
 * can exist in both surfaces: the sidebar reports its session here so the editor tab claims it and the panel does not.
 */
let current: string | undefined
let tabs: (sessionId: string) => boolean = () => false

export function setSidebarSession(sessionId: string | undefined): void {
  current = sessionId
}

export function sidebarSession(): string | undefined {
  return current
}

/** Register the check for open editor tabs. A tab keeps its session even before it opens a page. */
export function setEditorTabs(has: (sessionId: string) => boolean): void {
  tabs = has
}

/** True when the editor tab serves the session: the sidebar shows it, or a tab for it is open. */
export function editorTabOwns(sessionId: string): boolean {
  return sessionId === current || tabs(sessionId)
}
