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

/**
 * Let the Agent Manager terminal shortcuts work while a VS Code terminal has focus. The terminal sends every
 * keystroke to the shell unless its command is in `terminal.integrated.commandsToSkipShell`, which only lists
 * built-in commands by default.
 */
export function ensureCommandsSkipShell(): void {
  const commands = [
    "kilo-code.v2.agentManager.open",
    "kilo-code.v2.agentManager.showTerminal",
    "kilo-code.v2.agentManager.previousTerminal",
    "kilo-code.v2.agentManager.nextTerminal",
    // Its keybinding is active in a focused terminal only on macOS.
    ...(process.platform === "darwin" ? ["kilo-code.v2.agentManager.runScript"] : []),
  ]
  const config = vscode.workspace.getConfiguration("terminal.integrated")
  const info = config.inspect<string[]>("commandsToSkipShell")
  // Update the scope that already has an override, so a workspace value is not shadowed or copied to global.
  const [existing, target] = info?.workspaceFolderValue
    ? [info.workspaceFolderValue, vscode.ConfigurationTarget.WorkspaceFolder]
    : info?.workspaceValue
      ? [info.workspaceValue, vscode.ConfigurationTarget.Workspace]
      : [info?.globalValue ?? [], vscode.ConfigurationTarget.Global]
  const missing = commands.filter((command) => !existing.includes(command))
  if (missing.length === 0) return
  void config.update("commandsToSkipShell", [...existing, ...missing], target)
}
