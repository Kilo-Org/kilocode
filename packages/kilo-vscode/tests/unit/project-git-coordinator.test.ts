import { describe, expect, it } from "bun:test"
import { GitOps } from "../../src/agent-manager/GitOps"
import {
  ProjectGitCoordinator,
  ProjectGitError,
  setProjectPolling,
  shouldPollProject,
} from "../../src/agent-manager/project-git"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"
import type { Project } from "../../src/agent-manager/project-registry"

function project(id: string, root: string): Project {
  return { id, root, order: 0, collapsed: false, trusted: true }
}

function state(branch: string, prNumber: number) {
  const worktree = {
    id: "wt-1",
    branch,
    path: `/worktrees/${branch}`,
    parentBranch: "main",
    createdAt: "2026-01-01T00:00:00.000Z",
    prNumber,
  }
  return {
    load: async () => ({ status: "loaded", refsFixed: 0 }),
    flush: async () => undefined,
    getWorktrees: () => [worktree],
    getWorktree: (id: string) => (id === worktree.id ? worktree : undefined),
    getSessions: () => [],
    getSession: () => undefined,
    getSections: () => [],
    getTabOrder: () => ({}),
    getWorktreeOrder: () => [],
    getSessionsCollapsed: () => false,
    getSidebarCollapsed: () => false,
    getReviewDiffStyle: () => "unified" as const,
    getDefaultBaseBranch: () => undefined,
    updateWorktreePR: () => undefined,
    updateWorktreeBranch: () => false,
  }
}

describe("ProjectGitCoordinator", () => {
  it("publishes isolated Git state for two projects", async () => {
    const projects = [project("frontend", "/projects/frontend"), project("backend", "/projects/backend")]
    const states = { frontend: state("frontend-main", 10), backend: state("backend-main", 20) }
    const messages: AgentManagerOutMessage[] = []
    const routing = {
      loaded: async () => undefined,
      snapshot: () => ({ projects }),
      getProject: (id: string) => projects.find((item) => item.id === id),
      projectFor: (id: string) => {
        const item = projects.find((value) => value.id === id)
        if (!item) return undefined
        return {
          id: item.id,
          root: item.root,
          getWorktreeManager: () => ({
            currentBranch: async () => `${item.id}-main`,
            defaultBranch: async () => "main",
          }),
          getStateManager: () => states[id as keyof typeof states],
          getGitScope: (build: () => unknown) => build(),
        }
      },
    }
    const controller = new ProjectGitCoordinator(routing, {
      git: new GitOps({ log: () => undefined, runGit: async () => "" }),
      localDiff: async () => [],
      post: (message) => messages.push(message),
      openExternal: () => undefined,
      log: () => undefined,
      visible: () => false,
      active: () => undefined,
      error: () => undefined,
    })

    await controller.refresh()

    const output = messages.filter((message) => message.type === "agentManager.state")
    expect(output).toHaveLength(2)
    expect(output[0]).toMatchObject({
      projectId: "frontend",
      branch: "frontend-main",
      worktrees: [{ id: "wt-1", branch: "frontend-main", prNumber: 10 }],
    })
    expect(output[1]).toMatchObject({
      projectId: "backend",
      branch: "backend-main",
      worktrees: [{ id: "wt-1", branch: "backend-main", prNumber: 20 }],
    })
  })

  it("pauses collapsed inactive projects and resumes active projects", () => {
    const stats: boolean[] = []
    const prs: boolean[] = []
    const scope = {
      stats: { setVisible: () => undefined, setEnabled: (value: boolean) => stats.push(value) },
      pr: { poller: { setVisible: () => undefined, setEnabled: (value: boolean) => prs.push(value) } },
    }
    const item = project("backend", "/projects/backend")

    setProjectPolling(scope as never, { ...item, collapsed: true }, false, true)
    setProjectPolling(scope as never, { ...item, collapsed: true }, true, true)
    setProjectPolling(scope as never, { ...item, collapsed: false }, false, true)

    expect(stats).toEqual([false, true, true])
    expect(prs).toEqual([false, true, true])
    expect(shouldPollProject(undefined, false)).toBe(true)
  })

  it("refuses Git operations without a project once projects are registered", () => {
    const errors: ProjectGitError[] = []
    const item = project("backend", "/projects/backend")
    const controller = new ProjectGitCoordinator(
      {
        loaded: async () => undefined,
        snapshot: () => ({ projects: [item] }),
        getProject: (id) => (id === item.id ? item : undefined),
        projectFor: () => undefined,
      },
      {
        git: new GitOps({ log: () => undefined, runGit: async () => "" }),
        localDiff: async () => [],
        post: () => undefined,
        openExternal: () => undefined,
        log: () => undefined,
        visible: () => false,
        active: () => undefined,
        error: (message) => errors.push(message),
      },
    )

    expect(controller.requireProject(undefined)).toBe(false)
    expect(errors).toMatchObject([{ code: "project_required", message: "Project context required" }])
  })

  it("refuses Git manager access for an unknown project", () => {
    const errors: ProjectGitError[] = []
    const controller = new ProjectGitCoordinator(
      {
        loaded: async () => undefined,
        snapshot: () => ({ projects: [] }),
        getProject: () => undefined,
        projectFor: () => undefined,
      },
      {
        git: new GitOps({ log: () => undefined, runGit: async () => "" }),
        localDiff: async () => [],
        post: () => undefined,
        openExternal: () => undefined,
        log: () => undefined,
        visible: () => false,
        active: () => undefined,
        error: (message) => errors.push(message),
      },
    )

    expect(controller.requireProject(undefined)).toBe(true)
    expect(controller.manager("missing")).toBeUndefined()
    expect(errors).toMatchObject([{ code: "unknown_project", projectId: "missing" }])
  })
})
