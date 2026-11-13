import * as vscode from "vscode"

/** Remove the application-scoped value of the retired terminal destination setting. */
export async function clearLegacyTerminalDestination(): Promise<void> {
  const config = vscode.workspace.getConfiguration("kilo-code.v2.agentManager")
  if (config.inspect("terminalButtonDestination")?.globalValue === undefined) return
  await config.update("terminalButtonDestination", undefined, vscode.ConfigurationTarget.Global)
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
