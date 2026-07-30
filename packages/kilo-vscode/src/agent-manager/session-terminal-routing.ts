import type { WorktreeStateManager } from "./WorktreeStateManager"

export type SessionTerminalRequest =
  | { type: "agentManager.showTerminal"; sessionId: string }
  | { type: "agentManager.showLocalTerminal" }
  | { type: "agentManager.showWorktreeTerminal"; worktreeId: string }

interface SessionTerminals {
  showTerminal(sessionId: string, state: WorktreeStateManager | undefined): void
  showLocalTerminal(): void
  showWorktreeTerminal(worktreeId: string, state: WorktreeStateManager | undefined): void
}

interface SessionTerminalRoute {
  destination: "vscode" | "agentManager"
  state: WorktreeStateManager | undefined
  terminals: SessionTerminals
  openSide(): void
}

/**
 * Route session/worktree terminal actions through the same destination as
 * the Agent Manager terminal button. The embedded terminal already derives
 * its cwd from the active sidebar context, so the provider only needs to
 * ask the webview to reveal that context's side terminal.
 */
export function routeSessionTerminal(message: { type: string }, route: SessionTerminalRoute): boolean {
  if (
    message.type !== "agentManager.showTerminal" &&
    message.type !== "agentManager.showLocalTerminal" &&
    message.type !== "agentManager.showWorktreeTerminal"
  ) {
    return false
  }

  if (route.destination === "agentManager") {
    route.openSide()
    return true
  }

  const request = message as SessionTerminalRequest
  if (request.type === "agentManager.showTerminal") route.terminals.showTerminal(request.sessionId, route.state)
  else if (request.type === "agentManager.showLocalTerminal") route.terminals.showLocalTerminal()
  else route.terminals.showWorktreeTerminal(request.worktreeId, route.state)
  return true
}
