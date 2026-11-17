import { describe, expect, it } from "bun:test"
import {
  WorktreeImporter,
  type WorktreeImporterHost,
} from "../src/agent-manager/worktree-importer"
import type { AgentManagerOutMessage } from "../src/agent-manager/types"

function importer(listBranches?: () => Promise<{ branches: { name: string }[]; defaultBranch: string }>) {
  const posts: AgentManagerOutMessage[] = []
  const manager = listBranches
    ? {
        repo: "/repo/main",
        listBranches,
        prefetchBase: async () => {},
        checkedOutBranches: async () => new Set<string>(),
      }
    : undefined
  const host = {
    manager: () => manager,
    state: () => undefined,
    post: (message: AgentManagerOutMessage) => posts.push(message),
    push: () => {},
    setup: async () => {},
    session: async () => null,
    register: () => {},
    ready: () => {},
    log: () => {},
  } as unknown as WorktreeImporterHost
  return { branches: new WorktreeImporter(host).branches("p1"), posts }
}

describe("branch list blockers", () => {
  it("reports a folder without a repository", async () => {
    const { branches, posts } = importer()
    await branches

    expect(posts.at(-1)).toMatchObject({ type: "agentManager.branches", projectId: "p1", errorCode: "not_git_repo" })
  })

  it("reports a repository without commits", async () => {
    const { branches, posts } = importer(async () => {
      throw new Error("This repository has no commits yet. Create an initial commit before using worktrees.")
    })
    await branches

    expect(posts.at(-1)).toMatchObject({ projectId: "p1", errorCode: "no_commits", branches: [] })
  })

  it("reports a folder that is not a repository", async () => {
    const { branches, posts } = importer(async () => {
      throw new Error("fatal: not a git repository (or any of the parent directories): .git")
    })
    await branches

    expect(posts.at(-1)).toMatchObject({ projectId: "p1", errorCode: "not_git_repo" })
  })

  it("leaves other failures as the plain empty list and keeps a healthy list clean", async () => {
    const failed = importer(async () => {
      throw new Error("fatal: something else")
    })
    await failed.branches
    expect(failed.posts.at(-1)).toMatchObject({ branches: [] })
    expect(failed.posts.at(-1)).not.toHaveProperty("errorCode")

    const healthy = importer(async () => ({ branches: [{ name: "main" }], defaultBranch: "main" }))
    await healthy.branches
    expect(healthy.posts.at(-1)).toMatchObject({
      projectId: "p1",
      branches: [{ name: "main", isCheckedOut: false }],
      defaultBranch: "main",
    })
    expect(healthy.posts.at(-1)).not.toHaveProperty("errorCode")
  })
})
