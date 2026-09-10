/** Vscode-free presence state for the Agent Manager.
 *
 * Owns the displayed session id and the open-tab session set. Both are gated
 * on panel visibility: when the panel is hidden (retainContextWhenHidden
 * keeps the webview alive), flush() clears both registrations so the retained
 * webview's reactive updates cannot keep stale sessions attached or visible.
 * When the panel returns, flush() re-registers from stored state. */

type Register = (ids: string[]) => void

type PresenceMessage =
  | { type: "agentManager.openSessions"; sessionIDs: string[] }
  | { type: "agentManager.visibleSession"; sessionID: string | null }

export class AgentManagerVisiblePresence {
  private id: string | null = null
  private open: string[] = []
  constructor(
    private readonly register: Register,
    private readonly panelVisible: () => boolean,
    private readonly registerAttached: Register,
  ) {}

  setDisplayed(id: string | null): void {
    this.id = id
    this.flush()
  }

  flush(): void {
    if (this.panelVisible()) {
      this.register(this.id ? [this.id] : [])
      this.registerAttached(this.open)
    } else {
      this.register([])
      this.registerAttached([])
    }
  }

  handle(m: PresenceMessage): void {
    if (m.type === "agentManager.openSessions") this.open = m.sessionIDs
    else this.id = m.sessionID
    this.flush()
  }

  clear(): void {
    this.id = null
    this.open = []
    this.register([])
    this.registerAttached([])
  }
}
