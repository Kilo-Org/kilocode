import type { PermissionFileDiff } from "../types/messages"

export interface AgentManagerEditPreviewDetail {
  diff: PermissionFileDiff
  sessionID?: string
  initialDiffStyle: "unified" | "split"
}

export function dispatchAgentManagerEditPreview(detail: AgentManagerEditPreviewDetail): void {
  window.dispatchEvent(new CustomEvent("agentManager.openEditPreview", { detail }))
}
