import type { AgentManagerInMessage } from "./types"
import type { DestinationState } from "./terminal-destination"
import type { RunController } from "./run/controller"
import type { SessionTerminalManager } from "./SessionTerminalManager"
import type { WorktreeStateManager } from "./WorktreeStateManager"
import { handleDestination } from "./terminal-destination"
import { handleRunMessage } from "./run/message"
import { handleTabLayoutMessage } from "./tab-layout"
import { normalizeBaseBranch } from "./base-branch"

/**
 * Dependencies the state and UI in-message branches need. Kept explicit so the
 * routing logic stays vscode-free and the provider only supplies capabilities.
 */
export interface MessageRoutingDeps {
  readonly state: WorktreeStateManager | undefined
  readonly destination: DestinationState
  readonly run: RunController
  readonly terminalManager: SessionTerminalManager
  readonly getStateManager: () => WorktreeStateManager | undefined
  readonly runKey: (worktreeId: string) => string
  readonly requestState: () => void
  readonly pushState: () => void
  readonly handleSection: (m: AgentManagerInMessage) => boolean
  readonly setMarkdownRender: (render: boolean) => void
  readonly configureSetupScript: () => void
  readonly openWorktreeDirectory: (worktreeId: string) => void
  readonly copyToClipboard: (text: string) => void
  readonly sendRepoInfo: () => void
  readonly createMultiVersion: (m: Extract<AgentManagerInMessage, { type: "agentManager.createMultiVersion" }>) => void
  readonly log: (...args: unknown[]) => void
}

/** Route state-settings messages. Returns `null` when handled, else `undefined`. */
export function stateMessage(
  deps: MessageRoutingDeps,
  m: AgentManagerInMessage,
): Record<string, unknown> | null | undefined {
  if (m.type === "agentManager.requestState") {
    deps.requestState()
    return null
  }
  if (handleTabLayoutMessage(deps.state, m)) return null
  if (m.type === "agentManager.setWorktreeOrder") {
    const state = deps.getStateManager()
    if (state) {
      state.setWorktreeOrder(m.order)
      deps.pushState()
    }
    return null
  }
  if (m.type === "agentManager.setSessionsCollapsed") {
    deps.state?.setSessionsCollapsed(m.collapsed)
    // Project bodies render collapsed from pushed state, so the mutation
    // must round-trip.
    deps.pushState()
    return null
  }
  if (m.type === "agentManager.setSidebarCollapsed") {
    deps.state?.setSidebarCollapsed(m.collapsed)
    return null
  }
  if (deps.handleSection(m)) return null
  if (m.type === "agentManager.setReviewDiffStyle") {
    deps.state?.setReviewDiffStyle(m.style)
    return null
  }
  if (m.type === "agentManager.setReviewMarkdownRender") {
    deps.setMarkdownRender(m.render)
    return null
  }
  if (m.type === "agentManager.setDefaultBaseBranch") {
    deps.state?.setDefaultBaseBranch(normalizeBaseBranch(m.branch))
    deps.pushState()
    return null
  }
}

/** Route setup, run, terminal, and window UI messages. Returns `null` when handled. */
export function uiMessage(
  deps: MessageRoutingDeps,
  m: AgentManagerInMessage,
  msg: Record<string, unknown>,
): Record<string, unknown> | null | undefined {
  if (m.type === "agentManager.configureSetupScript") {
    deps.configureSetupScript()
    return null
  }
  if (handleDestination(deps.destination, m, (message) => deps.log("[XTerm]", message))) return null
  if (handleRunMessage(deps.run, m, (id) => deps.runKey(id))) return null
  if (m.type === "agentManager.showTerminal") {
    deps.terminalManager.showTerminal(m.sessionId, deps.state)
    return null
  }
  if (m.type === "agentManager.showLocalTerminal") {
    deps.terminalManager.showLocalTerminal()
    return null
  }
  if (m.type === "agentManager.showWorktreeTerminal") {
    deps.terminalManager.showWorktreeTerminal(m.worktreeId, deps.state)
    return null
  }
  if (m.type === "agentManager.openWorktree") {
    deps.openWorktreeDirectory(m.worktreeId)
    return null
  }
  if (m.type === "agentManager.copyToClipboard") {
    deps.copyToClipboard(m.text)
    return null
  }
  if (m.type === "previewImage") return msg
  if (m.type === "saveImage") return msg
  if (m.type === "agentManager.showExistingLocalTerminal") {
    deps.terminalManager.syncLocalOnSessionSwitch()
    return null
  }
  if (m.type === "agentManager.requestRepoInfo") {
    deps.sendRepoInfo()
    return null
  }
  if (m.type === "agentManager.createMultiVersion") {
    deps.createMultiVersion(m)
    return null
  }
  if (m.type === "agentManager.renameWorktree") {
    const state = deps.getStateManager()
    if (state) {
      state.updateWorktreeLabel(m.worktreeId, m.label)
      deps.pushState()
    }
    return null
  }
}
