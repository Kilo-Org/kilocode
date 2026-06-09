import type { AgentManagerCloudStatus } from "../../types/messages/extension-messages"

const steps: Partial<Record<NonNullable<AgentManagerCloudStatus["step"]>, string>> = {
  disk_check: "diskCheck",
  workspace_setup: "workspaceSetup",
  cloning: "cloning",
  branch: "branch",
  devcontainer_setup: "devcontainerSetup",
  setup_commands: "setupCommands",
  kilo_server: "kiloServer",
  kilo_session: "kiloSession",
  ready: "ready",
  failed: "failed",
}

export function cloudStatusError(status?: AgentManagerCloudStatus) {
  return status?.type === "error" || status?.step === "failed"
}

export function cloudStatusKey(status?: AgentManagerCloudStatus) {
  if (!status || status.type === "ready") return
  if (cloudStatusError(status)) return "agentManager.cloud.status.failed"
  const step = status.step && steps[status.step]
  return `agentManager.cloud.status.${step ?? status.type}`
}
