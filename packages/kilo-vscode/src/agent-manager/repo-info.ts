import type { AgentManagerOutMessage } from "./types"
import type { WorktreeManager } from "./WorktreeManager"

export interface RepoInfoDeps {
  manager: WorktreeManager | undefined
  projectId?: string
  post: (message: AgentManagerOutMessage) => void
  log: (message: string) => void
}

/** Read the repository's current and default branches and push them to the webview. */
export async function sendRepoInfo(deps: RepoInfoDeps): Promise<void> {
  if (!deps.manager) return
  try {
    const branch = await deps.manager.currentBranch()
    const defaultBranch = await deps.manager.defaultBranch()
    deps.post({ type: "agentManager.repoInfo", branch, defaultBranch, projectId: deps.projectId })
  } catch (error) {
    deps.log(`Failed to get current branch: ${error}`)
  }
}
