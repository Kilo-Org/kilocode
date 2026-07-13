/** Vscode-free presence state for the Agent Manager.
 *
 * Owns the currently displayed real session id, computes the visible id set
 * gated on panel visibility, and forwards attached (open tab) registration.
 * The provider supplies the register callbacks (bound to the connection
 * service) and a `panelVisible` accessor. */

type Register = (ids: string[]) => void

type PresenceMessage =
  | { type: "agentManager.openSessions"; sessionIDs: string[] }
  | { type: "agentManager.visibleSession"; sessionID: string | null }

export class AgentManagerVisiblePresence {
  private id: string | null = null
  constructor(
    private readonly register: Register,
    private readonly panelVisible: () => boolean,
    private readonly registerAttached: Register,
  ) {}

  // Set the displayed session id (null for terminal/review/pending/empty) and flush.
  setDisplayed(id: string | null): void {
    this.id = id
    this.flush()
  }

  // Recompute visible presence from current panel visibility and displayed id.
  flush(): void {
    this.register(this.panelVisible() && this.id ? [this.id] : [])
  }

  // Route webview presence reports: open tab set → attached, displayed id → visible.
  handle(m: PresenceMessage): void {
    if (m.type === "agentManager.openSessions") this.registerAttached(m.sessionIDs)
    else this.setDisplayed(m.sessionID)
  }

  // Panel closed or provider disposed: clear both visible and attached registrations.
  clear(): void {
    this.setDisplayed(null)
    this.registerAttached([])
  }
}
