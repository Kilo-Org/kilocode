import type { WorktreeStateManager } from "./WorktreeStateManager"

// ---------------------------------------------------------------------------
// TerminalHost — narrow interface for the VS Code capabilities this module
// needs.  Implemented by AgentManagerProvider using the real vscode API.
// ---------------------------------------------------------------------------

export interface TerminalHandle {
  show(preserveFocus: boolean): void
  dispose(): void
  readonly exitStatus: { code?: number } | undefined
}

export interface TerminalHost {
  createTerminal(opts: { cwd: string; name: string }): TerminalHandle
  activeTerminal(): TerminalHandle | undefined
  repoPath(): string | undefined
  showWarning(msg: string): void
  setContext(key: string, value: boolean): void
  onTerminalClosed(cb: (handle: TerminalHandle) => void): Disposable
  onActiveTerminalChanged(cb: (handle: TerminalHandle | undefined) => void): Disposable
  registerCommand(id: string, handler: (...args: unknown[]) => Promise<unknown>): Disposable
  executeCommand(id: string, ...args: unknown[]): Promise<unknown>
}

export interface Disposable {
  dispose(): void
}

/**
 * Manages terminals for agent manager sessions.
 * Each session can have an associated terminal that opens in the session's worktree directory,
 * or the main repo folder for local sessions.
 */
export class SessionTerminalManager {
  private static readonly LOCAL_KEY = "__local__"

  private terminals = new Map<string, { terminal: TerminalHandle; cwd: string }>()
  private disposables: Disposable[] = []
  private commandHandlers = new Map<string, (...args: unknown[]) => Promise<unknown>>()
  private commandDisposables = new Map<string, Disposable>()
  private panelOpen = false

  constructor(
    private log: (msg: string) => void,
    private host: TerminalHost,
  ) {
    this.disposables.push(
      host.onTerminalClosed((terminal) => {
        for (const [sessionId, entry] of this.terminals) {
          if (entry.terminal !== terminal) continue
          this.terminals.delete(sessionId)
          this.log(`Removed terminal mapping for session ${sessionId} (terminal closed)`)
          break
        }
        this.updateContextKey()
      }),
      host.onActiveTerminalChanged((terminal) => {
        const managed = terminal ? this.isManaged(terminal) : false
        if (terminal) this.panelOpen = true
        void host.setContext("kilo-code.agentTerminalFocus", managed)
      }),
    )

    this.registerPanelCommand("workbench.action.togglePanel", () => {
      this.panelOpen = !this.panelOpen
      this.log(`panel visibility toggled via command (open=${this.panelOpen})`)
    })
    this.registerPanelCommand("workbench.action.closePanel", () => {
      this.panelOpen = false
      this.log("panel hidden via command")
    })
    this.registerPanelCommand("workbench.action.focusPanel", () => {
      this.panelOpen = true
      this.log("panel focused via command")
    })
    this.registerPanelCommand("workbench.action.terminal.focus", () => {
      this.panelOpen = true
      this.log("terminal focused via command")
    })
  }

  /**
   * Show (or create) a terminal for the given session.
   * Resolves CWD from the worktree state, falling back to repo root.
   */
  showTerminal(sessionId: string, state: WorktreeStateManager | undefined): void {
    // If terminal already exists, just focus it
    if (this.showExisting(sessionId, false)) return

    const repoPath = this.host.repoPath()
    const worktreePath = state?.directoryFor(sessionId)
    const cwd = worktreePath ?? repoPath

    if (!cwd) {
      this.log(`showTerminal: no cwd resolved for session ${sessionId}`)
      this.host.showWarning("Open a folder that contains a git repository to use worktrees")
      return
    }

    const session = state?.getSession(sessionId)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    const name = worktree ? `Agent: ${worktree.branch}` : "Agent: local"

    this.showOrCreate(sessionId, cwd, name)
  }

  /**
   * Show (or create) a terminal for the local repo (no session required).
   * Used when the user triggers a terminal in local mode without an active session.
   */
  showLocalTerminal(): void {
    if (this.showExisting(SessionTerminalManager.LOCAL_KEY, false)) return

    const cwd = this.host.repoPath()
    if (!cwd) {
      this.log("showLocalTerminal: no repo folder open")
      this.host.showWarning("Open a folder to use the local terminal")
      return
    }

    this.showOrCreate(SessionTerminalManager.LOCAL_KEY, cwd, "Agent: local")
  }

  /**
   * Show the existing local terminal if one was previously created (used on context switch).
   */
  showExistingLocal(): boolean {
    return this.showExisting(SessionTerminalManager.LOCAL_KEY)
  }

  /**
   * Sync terminal on session switch: only switch terminals when panel is open.
   */
  syncOnSessionSwitch(sessionId: string): boolean {
    if (!this.panelOpen) {
      this.log(`syncOnSessionSwitch: panel hidden, skipping session ${sessionId}`)
      return false
    }

    return this.showExisting(sessionId)
  }

  /**
   * Sync local terminal on context switch: only switch when panel is open.
   */
  syncLocalOnSessionSwitch(): boolean {
    if (!this.panelOpen) {
      this.log("syncLocalOnSessionSwitch: panel hidden, skipping")
      return false
    }

    return this.showExistingLocal()
  }

  /**
   * Show the terminal for a session if it already exists (used when switching sessions).
   * Returns true if the terminal was shown, false if no terminal exists for the session.
   * Pass preserveFocus=true to keep focus on the current editor (default for session switching).
   */
  showExisting(sessionId: string, preserveFocus = true): boolean {
    const entry = this.terminals.get(sessionId)
    if (!entry) return false

    if (entry.terminal.exitStatus !== undefined) {
      this.terminals.delete(sessionId)
      this.log(`showExisting: terminal exited for session ${sessionId}, clearing`)
      return false
    }

    entry.terminal.show(preserveFocus)
    this.panelOpen = true
    this.log(`showExisting: revealed terminal for session ${sessionId}`)
    return true
  }

  /**
   * Check if a session has an active terminal.
   */
  hasTerminal(sessionId: string): boolean {
    const entry = this.terminals.get(sessionId)
    return entry !== undefined && entry.terminal.exitStatus === undefined
  }

  dispose(): void {
    void this.host.setContext("kilo-code.agentTerminalFocus", false)
    for (const entry of this.terminals.values()) entry.terminal.dispose()
    this.terminals.clear()
    for (const d of this.commandDisposables.values()) d.dispose()
    this.commandDisposables.clear()
    this.commandHandlers.clear()
    for (const d of this.disposables) d.dispose()
  }

  private registerPanelCommand(id: string, onAfterRun: () => void): void {
    const handler = async (...args: unknown[]) => {
      const result = await this.runOriginalCommand(id, args)
      onAfterRun()
      return result
    }

    this.commandHandlers.set(id, handler)
    this.commandDisposables.set(id, this.host.registerCommand(id, handler))
  }

  private async runOriginalCommand(id: string, args: unknown[]): Promise<unknown> {
    const disposable = this.commandDisposables.get(id)
    if (!disposable) return this.host.executeCommand(id, ...args)

    disposable.dispose()
    this.commandDisposables.delete(id)

    try {
      return await this.host.executeCommand(id, ...args)
    } finally {
      const handler = this.commandHandlers.get(id)
      if (!handler) return
      const replacement = this.host.registerCommand(id, handler)
      this.commandDisposables.set(id, replacement)
    }
  }

  private isManaged(terminal: TerminalHandle): boolean {
    for (const entry of this.terminals.values()) {
      if (entry.terminal === terminal) return true
    }
    return false
  }

  private updateContextKey(): void {
    const active = this.host.activeTerminal()
    const managed = active ? this.isManaged(active) : false
    if (active) this.panelOpen = true
    void this.host.setContext("kilo-code.agentTerminalFocus", managed)
  }

  private showOrCreate(sessionId: string, cwd: string, name: string): void {
    let entry = this.terminals.get(sessionId)

    // Clean up exited terminals
    if (entry && entry.terminal.exitStatus !== undefined) {
      this.terminals.delete(sessionId)
      entry = undefined
    }

    // Recreate if CWD changed
    if (entry && entry.cwd !== cwd) {
      entry.terminal.dispose()
      this.terminals.delete(sessionId)
      entry = undefined
      this.log(`showTerminal: cwd changed for session ${sessionId}, recreating`)
    }

    if (!entry) {
      const terminal = this.host.createTerminal({ cwd, name })
      entry = { terminal, cwd }
      this.terminals.set(sessionId, entry)
      this.log(`showTerminal: created terminal for session ${sessionId} (cwd=${cwd})`)
    }

    entry.terminal.show(false)
    this.panelOpen = true
    this.updateContextKey()
  }
}
