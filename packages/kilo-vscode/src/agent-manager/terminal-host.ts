/**
 * VS Code adapter implementing the TerminalHost interface.
 */

import * as vscode from "vscode"
import type { TerminalHost, TerminalHandle } from "./SessionTerminalManager"

export function createTerminalHost(): TerminalHost {
  const terminalMap = new WeakMap<vscode.Terminal, TerminalHandle>()

  const wrap = (terminal: vscode.Terminal): TerminalHandle => {
    const existing = terminalMap.get(terminal)
    if (existing) return existing
    const handle: TerminalHandle = {
      show: (preserveFocus) => terminal.show(preserveFocus),
      dispose: () => terminal.dispose(),
      get exitStatus() {
        return terminal.exitStatus ? { code: terminal.exitStatus.code } : undefined
      },
    }
    terminalMap.set(terminal, handle)
    return handle
  }

  return {
    createTerminal: (opts) =>
      wrap(
        vscode.window.createTerminal({
          cwd: opts.cwd,
          name: opts.name,
          iconPath: new vscode.ThemeIcon("terminal"),
        }),
      ),
    activeTerminal: () => {
      const t = vscode.window.activeTerminal
      return t ? wrap(t) : undefined
    },
    repoPath: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    showWarning: (msg) => void vscode.window.showWarningMessage(msg),
    setContext: (key, value) => void vscode.commands.executeCommand("setContext", key, value),
    onTerminalClosed: (cb) => vscode.window.onDidCloseTerminal((terminal) => cb(wrap(terminal))),
    onActiveTerminalChanged: (cb) =>
      vscode.window.onDidChangeActiveTerminal((terminal) => cb(terminal ? wrap(terminal) : undefined)),
    registerCommand: (id, handler) => vscode.commands.registerCommand(id, handler),
    executeCommand: (id, ...args) => Promise.resolve(vscode.commands.executeCommand(id, ...args)),
  }
}
