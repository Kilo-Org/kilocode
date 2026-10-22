import type { AgentManagerInMessage } from "../types"
import type { RunController } from "./controller"

/**
 * The webview sends worktreeId "local" for whichever project's local context
 * is selected. In multi-project mode that key would collide across projects
 * in the provider-wide RunScriptManager, so the provider passes a qualifier
 * that namespaces it with the owning project id.
 */
export function handleRunMessage(
  run: RunController,
  msg: AgentManagerInMessage,
  qualify?: (worktreeId: string) => string,
): boolean {
  if (msg.type === "agentManager.configureRunScript") {
    void run.configure()
    return true
  }
  if (msg.type === "agentManager.runScript") {
    void run.run(qualify?.(msg.worktreeId) ?? msg.worktreeId, msg.destination)
    return true
  }
  if (msg.type === "agentManager.stopRunScript") {
    run.stop(qualify?.(msg.worktreeId) ?? msg.worktreeId)
    return true
  }
  return false
}
