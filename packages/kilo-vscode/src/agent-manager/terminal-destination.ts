/**
 * Read and watch the user's Agent Manager terminal destination setting.
 *
 * The terminal button and `Cmd/Ctrl+/` either open the VS Code integrated
 * terminal (default, backwards compatible) or an embedded xterm in the
 * Agent Manager side panel. Kept next to `terminal-font.ts`; a separate
 * module so the font helpers stay untouched.
 */

import * as vscode from "vscode"

export type TerminalDestination = "vscode" | "agentManager"

const KEY = "kilo-code.new.agentManager.terminalButtonDestination"

/** Unknown values fall back to the VS Code terminal so a stale or
 *  hand-edited setting never strands the user without a terminal. */
export function resolveTerminalDestination(value: unknown): TerminalDestination {
  return value === "agentManager" ? value : "vscode"
}

export function readTerminalDestination(): TerminalDestination {
  const config = vscode.workspace.getConfiguration("kilo-code.new.agentManager")
  return resolveTerminalDestination(config.get("terminalButtonDestination"))
}

export function affectsTerminalDestination(e: vscode.ConfigurationChangeEvent): boolean {
  return e.affectsConfiguration(KEY)
}

/** Subscribe to destination changes. Returns a cleanup function. */
export function watchTerminalDestination(callback: (destination: TerminalDestination) => void): () => void {
  const sub = vscode.workspace.onDidChangeConfiguration((e) => {
    if (affectsTerminalDestination(e)) callback(readTerminalDestination())
  })
  return () => sub.dispose()
}
