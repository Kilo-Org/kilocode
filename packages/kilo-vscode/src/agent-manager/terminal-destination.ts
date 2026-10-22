/**
 * Read and watch the user's Agent Manager terminal destination setting.
 *
 * The terminal button and `Cmd/Ctrl+/` either open the VS Code integrated
 * terminal or an embedded xterm in the Agent Manager side panel.
 * Kept next to `terminal-font.ts`; a separate module so the font helpers
 * stay untouched.
 */

import * as vscode from "vscode"

export type TerminalDestination = "vscode" | "agentManager"

const KEY = "kilo-code.new.agentManager.terminalButtonDestination"

/** Unknown values fall back to the VS Code terminal so a stale or
 *  hand-edited setting never strands the user without a terminal. */
export function resolveTerminalDestination(value: unknown): TerminalDestination {
  return value === undefined || value === "agentManager" ? "agentManager" : "vscode"
}

export function readTerminalDestination(): TerminalDestination {
  const config = vscode.workspace.getConfiguration("kilo-code.new.agentManager")
  return resolveTerminalDestination(config.get("terminalButtonDestination"))
}

async function writeTerminalDestination(destination: TerminalDestination): Promise<void> {
  const config = vscode.workspace.getConfiguration("kilo-code.new.agentManager")
  await config.update("terminalButtonDestination", destination, vscode.ConfigurationTarget.Global)
}

/** Per-panel destination source of truth; local choices beat setting echoes. */
export class DestinationState {
  private local = false

  constructor(private destination = readTerminalDestination()) {}

  value(): TerminalDestination {
    return this.destination
  }

  sync(destination: TerminalDestination): void {
    if (!this.local) this.destination = destination
  }

  select(destination: TerminalDestination): void {
    this.local = true
    this.destination = destination
  }
}

export function handleDestination(
  state: DestinationState,
  message: { type: string; destination?: unknown },
  log: (message: string) => void,
): boolean {
  if (message.type !== "agentManager.terminal.destinationSelected") return false
  const destination = resolveTerminalDestination(message.destination)
  state.select(destination)
  void writeTerminalDestination(destination).catch((error) => {
    log(`Failed to persist terminal destination: ${error instanceof Error ? error.message : String(error)}`)
  })
  return true
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
