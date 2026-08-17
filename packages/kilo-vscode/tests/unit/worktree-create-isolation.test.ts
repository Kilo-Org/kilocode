import { describe, expect, test } from "bun:test"
import { createWorktreeOnDisk, type CreateWorktreeOnDiskContext } from "../../src/agent-manager/worktree-create"
import type { CreateWorktreeResult, WorktreeManager } from "../../src/agent-manager/WorktreeManager"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

describe("createWorktreeOnDisk isolation", () => {
  test("rolls back a created worktree when isolation fails", async () => {
    const removed: string[] = []
    const created: CreateWorktreeResult = {
      path: "C:\\repo",
      branch: "kilo/wt-1",
      parentBranch: "main",
      remote: undefined,
      startPointSource: "local-branch",
    }
    const manager = {
      createWorktree: async () => created,
      removeWorktree: async (worktreePath: string) => {
        removed.push(worktreePath)
      },
      branchExists: async () => true,
    } as unknown as WorktreeManager
    const state = {
      getDefaultBaseBranch: () => undefined,
      addWorktree: () => {
        throw new Error("must not register an isolated root worktree")
      },
    } as unknown as WorktreeStateManager
    const posted: unknown[] = []
    const ctx: CreateWorktreeOnDiskContext = {
      getWorktreeManager: () => manager,
      getStateManager: () => state,
      getWorkspaceRoot: () => "C:\\repo",
      postToWebview: (message) => {
        posted.push(message)
      },
      capture: () => undefined,
      pushState: () => undefined,
      log: () => undefined,
    }

    expect(await createWorktreeOnDisk(ctx)).toBeNull()
    expect(removed).toEqual(["C:\\repo"])
    expect(posted.some((message) => (message as { type?: string }).type === "agentManager.worktreeSetup")).toBe(true)
  })
})
