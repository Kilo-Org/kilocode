import type { AgentManagerOutMessage } from "../types"
import { composeDiffId, normalizeScope } from "../diff-scope"
import type { WorktreeDiffController } from "../worktree-diff-controller"

export async function sendDiffBranches(
  diffs: WorktreeDiffController,
  post: (message: AgentManagerOutMessage) => void,
  log: (...args: unknown[]) => void,
  sessionId: string,
  scope?: string,
  projectId?: string,
): Promise<void> {
  const id = composeDiffId(sessionId, normalizeScope(scope))
  const result = await diffs.branches(id).catch((err) => {
    log("Failed to list diff branches:", err instanceof Error ? err.message : String(err))
    return undefined
  })
  if (!result) return
  post({
    type: "agentManager.diffBranches",
    projectId,
    sessionId: id,
    branches: result.branches,
    defaultBranch: result.defaultBranch,
    autoBase: result.autoBase,
    currentBase: result.currentBase,
    isAuto: result.isAuto,
    currentBranch: result.currentBranch,
  })
}
