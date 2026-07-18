import type {
  AgentManagerLocalStatsMessage,
  AgentManagerPRStatusMessage,
  AgentManagerRepoInfoMessage,
  AgentManagerStateMessage,
  AgentManagerWorktreeStatsMessage,
  LocalGitStats,
  PRStatus,
  WorktreeGitStats,
  WorktreeState,
} from "../src/types/messages"

export interface ProjectGitView {
  state?: AgentManagerStateMessage
  local?: LocalGitStats
  stats: Record<string, WorktreeGitStats>
  prs: Record<string, PRStatus | null>
}

export type ProjectGitMessage =
  | AgentManagerStateMessage
  | AgentManagerRepoInfoMessage
  | AgentManagerWorktreeStatsMessage
  | AgentManagerLocalStatsMessage
  | AgentManagerPRStatusMessage

export function projectPRNumber(
  view: ProjectGitView | undefined,
  worktree: Pick<WorktreeState, "id" | "prNumber">,
): number | undefined {
  if (Object.prototype.hasOwnProperty.call(view?.prs ?? {}, worktree.id)) return view?.prs[worktree.id]?.number
  return worktree.prNumber
}

export function reduceProjectGit(
  views: Record<string, ProjectGitView>,
  message: ProjectGitMessage,
): Record<string, ProjectGitView> {
  const id = message.projectId
  if (!id) return views
  const current = views[id] ?? { stats: {}, prs: {} }

  if (message.type === "agentManager.state") {
    return { ...views, [id]: { ...current, state: message } }
  }
  if (message.type === "agentManager.repoInfo") {
    if (!current.state) return views
    return {
      ...views,
      [id]: {
        ...current,
        state: { ...current.state, branch: message.branch, defaultBranch: message.defaultBranch },
      },
    }
  }
  if (message.type === "agentManager.worktreeStats") {
    const stats = Object.fromEntries(message.stats.map((value) => [value.worktreeId, value]))
    return { ...views, [id]: { ...current, stats } }
  }
  if (message.type === "agentManager.localStats") {
    return { ...views, [id]: { ...current, local: message.stats } }
  }
  return { ...views, [id]: { ...current, prs: { ...current.prs, [message.worktreeId]: message.pr } } }
}
