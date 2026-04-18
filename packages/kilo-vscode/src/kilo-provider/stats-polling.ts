import { GitOps } from "../agent-manager/GitOps"
import { GitStatsPoller, type LocalStats } from "../agent-manager/GitStatsPoller"
import { diffSummary as localDiffSummary } from "../agent-manager/local-diff"
import { getWorkspaceRoot } from "../review-utils"

export interface WorktreeStatsMessage {
  type: "worktreeStatsLoaded"
  files: number
  additions: number
  deletions: number
}

export interface StatsPollingHandle {
  poller: GitStatsPoller
  git: GitOps
}

export interface StatsPollingDeps {
  /** Called with the webview message built from a new local-stats snapshot. */
  onMessage: (msg: WorktreeStatsMessage) => void
}

/** Pure mapper — local stats → webview message. Exported for tests. */
export function mapLocalStats(stats: LocalStats): WorktreeStatsMessage {
  return {
    type: "worktreeStatsLoaded",
    files: stats.files,
    additions: stats.additions,
    deletions: stats.deletions,
  }
}

/**
 * Build and start a GitStatsPoller + GitOps pair for the sidebar diff badge.
 *
 * Extracted from KiloProvider.startStatsPolling() so the provider file stays
 * under the max-lines lint cap. Callers must dispose the returned handle
 * when tearing down:
 *
 *   handle.poller.stop()
 *   handle.git.dispose()
 */
export function buildStatsPolling(deps: StatsPollingDeps): StatsPollingHandle {
  const git = new GitOps({ log: () => {} })
  const poller = new GitStatsPoller({
    getWorktrees: () => [],
    getWorkspaceRoot: () => getWorkspaceRoot(),
    localDiff: (dir, base) => localDiffSummary(git, dir, base),
    git,
    onStats: () => {},
    onLocalStats: (stats) => deps.onMessage(mapLocalStats(stats)),
    log: () => {},
  })
  poller.setEnabled(true)
  return { poller, git }
}
