import type { AgentManagerInMessage } from "../types"
import type { RunController } from "./controller"

export function handleRunMessage(run: RunController, msg: AgentManagerInMessage): boolean {
  if (msg.type === "agentManager.configureRunScript") {
    void run.configure()
    return true
  }
  if (msg.type === "agentManager.runScript") {
    void run.run(msg.worktreeId)
    return true
  }
  if (msg.type === "agentManager.stopRunScript") {
    run.stop(msg.worktreeId)
    return true
  }
  return false
}
