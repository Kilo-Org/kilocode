import { describe, expect, it } from "bun:test"
import { projectPRNumber, reduceProjectGit } from "../../webview-ui/agent-manager/project-git-view"
import { gitProjectId } from "../../webview-ui/agent-manager/project-view"
import type {
  AgentManagerPRStatusMessage,
  AgentManagerStateMessage,
  AgentManagerWorktreeStatsMessage,
} from "../../webview-ui/src/types/messages"

function state(projectId: string, branch: string, prNumber: number): AgentManagerStateMessage {
  return {
    type: "agentManager.state",
    projectId,
    worktrees: [
      {
        id: "wt-1",
        branch,
        path: `/worktrees/${branch}`,
        parentBranch: "main",
        createdAt: "2026-01-01T00:00:00.000Z",
        prNumber,
      },
    ],
    sessions: [],
    branch,
  }
}

describe("project Git view state", () => {
  it("targets the legacy root or sole registered project", () => {
    const base = { root: "/repo", order: 0, collapsed: false, trusted: true }
    const frontend = { ...base, id: "frontend", isLegacyRoot: true }
    const backend = { ...base, id: "backend", root: "/backend", isLegacyRoot: false }

    expect(gitProjectId([frontend, backend])).toBe("frontend")
    expect(gitProjectId([backend])).toBe("backend")
    expect(gitProjectId([backend, { ...frontend, isLegacyRoot: false }])).toBeUndefined()
  })

  it("keeps same-named worktrees and PRs isolated by project", () => {
    const frontend = state("frontend", "frontend-main", 10)
    const backend = state("backend", "backend-main", 20)
    const frontStats: AgentManagerWorktreeStatsMessage = {
      type: "agentManager.worktreeStats",
      projectId: "frontend",
      stats: [{ worktreeId: "wt-1", files: 1, additions: 2, deletions: 0, ahead: 1, behind: 0 }],
    }
    const backStats: AgentManagerWorktreeStatsMessage = {
      type: "agentManager.worktreeStats",
      projectId: "backend",
      stats: [{ worktreeId: "wt-1", files: 3, additions: 4, deletions: 1, ahead: 0, behind: 2 }],
    }
    const frontPR: AgentManagerPRStatusMessage = {
      type: "agentManager.prStatus",
      projectId: "frontend",
      worktreeId: "wt-1",
      pr: null,
    }
    const backPR: AgentManagerPRStatusMessage = {
      type: "agentManager.prStatus",
      projectId: "backend",
      worktreeId: "wt-1",
      pr: {
        number: 22,
        title: "Backend PR",
        url: "https://github.com/acme/backend/pull/22",
        state: "open",
        review: null,
        checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, items: [] },
        additions: 4,
        deletions: 1,
        files: 3,
      },
    }

    const result = [frontend, backend, frontStats, backStats, frontPR, backPR].reduce(reduceProjectGit, {})

    expect(result.frontend?.state?.branch).toBe("frontend-main")
    expect(result.backend?.state?.branch).toBe("backend-main")
    expect(result.frontend?.stats["wt-1"]?.additions).toBe(2)
    expect(result.backend?.stats["wt-1"]?.additions).toBe(4)
    expect(result.frontend?.prs["wt-1"]).toBeNull()
    expect(result.backend?.prs["wt-1"]?.number).toBe(22)
    expect(projectPRNumber(result.frontend, { id: "wt-1", prNumber: 10 })).toBeUndefined()
    expect(projectPRNumber(result.backend, { id: "wt-1", prNumber: 20 })).toBe(22)
  })

  it("ignores legacy messages without a project id", () => {
    expect(reduceProjectGit({}, { type: "agentManager.state", worktrees: [], sessions: [] })).toEqual({})
  })
})
