import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { BranchNamingController } from "../../src/agent-manager/branch-naming"
import { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

function deferred<T>() {
  const result = Promise.withResolvers<T>()
  return result
}

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

describe("BranchNamingController", () => {
  let root: string
  let state: WorktreeStateManager

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "branch-naming-test-"))
    fs.mkdirSync(path.join(root, ".kilo"), { recursive: true })
    state = new WorktreeStateManager(root, () => {})
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("retries on a later message when the first attempt is not clear yet", async () => {
    const wt = state.addWorktree({
      branch: "quiet-river",
      path: "/tmp/quiet-river",
      parentBranch: "main",
      branchOwned: true,
    })
    state.addSession("session-1", wt.id)
    state.armAutoName(wt.id, "session-1")
    const renamed: string[] = []
    let requests = 0
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({
        renameBranch: async (_path, _current, branch) => {
          renamed.push(branch)
          return branch
        },
      }),
      client: async () => ({
        branchName: {
          generate: async () => {
            requests += 1
            return { data: { branch: requests === 1 ? null : "fix-final-task" } }
          },
        },
      }),
      settings: () => ({ enabled: true, prefix: "" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "hi" })
    await settle()
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBe("session-1")
    naming.prompt({ sessionID: "session-1", text: "Fix the task" })
    await settle()

    expect(requests).toBe(2)
    expect(renamed).toEqual(["fix-final-task"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("renames once and applies the user prefix", async () => {
    const wt = state.addWorktree({
      branch: "quiet-river",
      path: "/tmp/quiet-river",
      parentBranch: "main",
      branchOwned: true,
    })
    state.addSession("session-1", wt.id)
    state.armAutoName(wt.id, "session-1")
    const prompts: string[] = []
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({ renameBranch: async (_path, _current, branch) => branch }),
      client: async () => ({
        branchName: {
          generate: async (input) => {
            prompts.push(input.prompt)
            return { data: { branch: "fix-token-refresh-race" } }
          },
        },
      }),
      settings: () => ({ enabled: true, prefix: "Marius / Features" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "Fix the token refresh race" })
    await settle()

    expect(prompts).toEqual(["Fix the token refresh race"])
    expect(state.getWorktree(wt.id)).toMatchObject({
      branch: "marius/features/fix-token-refresh-race",
      autoNameSessionId: undefined,
    })
  })

  it("does not touch an explicitly named branch", async () => {
    const wt = state.addWorktree({
      branch: "my-custom-branch",
      path: "/tmp/custom",
      parentBranch: "main",
      branchOwned: true,
    })
    state.addSession("session-1", wt.id)
    let requests = 0
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({ renameBranch: async (_path, _current, branch) => branch }),
      client: async () => ({
        branchName: {
          generate: async () => {
            requests += 1
            return { data: { branch: "replace-custom-name" } }
          },
        },
      }),
      settings: () => ({ enabled: true, prefix: "" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "Implement auth" })
    await settle()

    expect(requests).toBe(0)
    expect(state.getWorktree(wt.id)?.branch).toBe("my-custom-branch")
  })

  it("does not start another request while naming is pending", async () => {
    const wt = state.addWorktree({
      branch: "quiet-river",
      path: "/tmp/quiet-river",
      parentBranch: "main",
      branchOwned: true,
    })
    state.addSession("session-1", wt.id)
    state.armAutoName(wt.id, "session-1")
    const first = deferred<{ data: { branch: string | null } }>()
    const renamed: string[] = []
    let requests = 0
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({
        renameBranch: async (_path, _current, branch) => {
          renamed.push(branch)
          return branch
        },
      }),
      client: async () => ({
        branchName: {
          generate: async () => {
            requests += 1
            return first.promise
          },
        },
      }),
      settings: () => ({ enabled: true, prefix: "" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "Explore some options" })
    await Promise.resolve()
    naming.prompt({ sessionID: "session-1", text: "Fix the final task" })
    await settle()
    first.resolve({ data: { branch: "explore-options" } })
    await settle()

    expect(requests).toBe(1)
    expect(renamed).toEqual(["explore-options"])
  })
})
