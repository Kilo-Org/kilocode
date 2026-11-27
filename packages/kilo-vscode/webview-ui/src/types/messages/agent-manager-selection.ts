import type { AgentManagerSidebarTarget } from "./agent-manager"

export interface AgentManagerSelectionActivatedMessage {
  type: "agentManager.selectionActivated"
  target: AgentManagerSidebarTarget
  seq?: number
}

export interface ActivateSelectionMessage {
  type: "agentManager.activateSelection"
  target: AgentManagerSidebarTarget
  /** Resolve the project's persisted target instead of using `target` verbatim. */
  restore?: boolean
  seq?: number
}
