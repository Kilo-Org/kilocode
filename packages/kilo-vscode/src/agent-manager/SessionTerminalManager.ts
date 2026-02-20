import * as vscode from "vscode"
import type { WorktreeStateManager } from "./WorktreeStateManager"

/**
 * Manages VS Code terminals for agent manager sessions.
 * Each session can have an associated terminal that opens in the session's worktree directory,
 * or the main workspace folder for local sessions.
 */
export class SessionTerminalManager {
  private terminals = new Map<string, { terminal: vscode.Terminal; cwd: string }>()
  private disposables: vscode.Disposable[] = []

  constructor(private log: (msg: string) => void) {
    this.disposables.push(
      vscode.window.onDidCloseTerminal((terminal) => {
        for (const [sessionId, entry] of this.terminals) {
          if (entry.terminal !== terminal) continue
          this.terminals.delete(sessionId)
          this.log(`Removed terminal mapping for session ${sessionId} (terminal closed)`)
          break
        }
        this.updateContextKey()
      }),
      vscode.window.onDidChangeActiveTerminal((terminal) => {
        const managed = terminal ? this.isManaged(terminal) : false
        vscode.commands.executeCommand("setContext", "kilo-code.agentTerminalFocus", managed)
      }),
    )
  }

  /**
   * Show (or create) a terminal for the given session.
   * Resolves CWD from the worktree state, falling back to workspace root.
   */
  showTerminal(sessionId: string, state: WorktreeStateManager | undefined): void {
    // If terminal already exists, just focus it
    if (this.showExisting(sessionId, false)) return

    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
    const worktreePath = state?.directoryFor(sessionId)
    const cwd = worktreePath ?? workspacePath

    if (!cwd) {
      this.log(`showTerminal: no cwd resolved for session ${sessionId}`)
      vscode.window.showWarningMessage("No workspace folder open")
      return
    }

    const session = state?.getSession(sessionId)
    const worktree = session?.worktreeId ? state?.getWorktree(session.worktreeId) : undefined
    const name = worktree ? `Agent: ${worktree.branch}` : "Agent: local"

    this.showOrCreate(sessionId, cwd, name)
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
    vscode.commands.executeCommand("setContext", "kilo-code.agentTerminalFocus", false)
    for (const entry of this.terminals.values()) entry.terminal.dispose()
    this.terminals.clear()
    for (const d of this.disposables) d.dispose()
  }

  private isManaged(terminal: vscode.Terminal): boolean {
    for (const entry of this.terminals.values()) {
      if (entry.terminal === terminal) return true
    }
    return false
  }

  private updateContextKey(): void {
    const active = vscode.window.activeTerminal
    const managed = active ? this.isManaged(active) : false
    vscode.commands.executeCommand("setContext", "kilo-code.agentTerminalFocus", managed)
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
      const terminal = vscode.window.createTerminal({
        cwd,
        name,
        iconPath: new vscode.ThemeIcon("terminal"),
      })
      entry = { terminal, cwd }
      this.terminals.set(sessionId, entry)
      this.log(`showTerminal: created terminal for session ${sessionId} (cwd=${cwd})`)
    }

    entry.terminal.show(false)
    this.updateContextKey()
  }
}
