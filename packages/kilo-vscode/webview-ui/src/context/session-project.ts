import type { ExtensionMessage } from "../types/messages"

export function agentProject(message: ExtensionMessage): string | undefined {
  if (message.type === "agentManager.projects") return message.projects.find((item) => item.active)?.id
  if (message.type === "agentManager.selectionActivated") return message.target.projectId
}

export function isStaleAgentSession(message: ExtensionMessage, projectId: string | undefined): boolean {
  return message.type === "sessionCreated" && !!message.projectId && !!projectId && message.projectId !== projectId
}
