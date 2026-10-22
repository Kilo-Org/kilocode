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

function makeNaming(
  state: WorktreeStateManager,
  deps: {
    generate?: (input: {
      directory: string
      sessionID: string
      prompt: string
      providerID?: string
      modelID?: string
    }) => Promise<{ data: { branch: string | null } }>
    rename?: (branch: string) => Promise<string>
    hasWork?: () => Promise<boolean>
  } = {},
) {
  const renamed: string[] = []
  const prompts: string[] = []
  const requests = { value: 0 }
  const generate = deps.generate ?? (() => Promise.resolve({ data: { branch: null } }))
  const naming = new BranchNamingController({
    state: () => state,
    manager: () => ({
      renameBranch: async (_p: string, _c: string, branch: string) => {
        renamed.push(branch)
        return deps.rename ? await deps.rename(branch) : branch
      },
      hasWork: async () => (deps.hasWork ? await deps.hasWork() : false),
    }),
    client: async () => ({
      branchName: {
        generate: async (input) => {
          requests.value += 1
          prompts.push(input.prompt)
          return generate(input)
        },
      },
    }),
    settings: () => ({ enabled: true, prefix: "" }),
    push: () => {},
    log: () => {},
  })
  return { naming, renamed, prompts, requests }
}

function armed(state: WorktreeStateManager, branch = "quiet-river") {
  const wt = state.addWorktree({ branch, path: "/tmp/" + branch, parentBranch: "main", branchOwned: true })
  state.addSession("session-1", wt.id)
  state.armAutoName(wt.id, "session-1")
  return wt
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

  it("skips the first prompt and names on the second", async () => {
    const wt = armed(state)
    const { naming, renamed, prompts, requests } = makeNaming(state, {
      generate: async () => ({ data: { branch: "fix-final-task" } }),
    })

    naming.prompt({ sessionID: "session-1", text: "hi" })
    await settle()
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBe("session-1")
    expect(requests.value).toBe(0)

    naming.prompt({ sessionID: "session-1", text: "Fix the task" })
    await settle()

    expect(requests.value).toBe(1)
    expect(prompts).toEqual(["Fix the task"])
    expect(renamed).toEqual(["fix-final-task"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("names on the first prompt once the worktree has work, via idle", async () => {
    const wt = armed(state)
    const { naming, renamed, requests } = makeNaming(state, {
      generate: async () => ({ data: { branch: "fix-token-refresh-race" } }),
      hasWork: async () => true,
    })

    naming.prompt({ sessionID: "session-1", text: "Fix the token refresh race" })
    await settle()
    expect(requests.value).toBe(0)
    naming.idle("session-1")
    await settle()

    expect(requests.value).toBe(1)
    expect(renamed).toEqual(["fix-token-refresh-race"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("applies the user prefix", async () => {
    const wt = armed(state)
    const prompts: string[] = []
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({ renameBranch: async (_p, _c, branch) => branch, hasWork: async () => true }),
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
    naming.idle("session-1")
    await settle()

    expect(prompts).toEqual([""])
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
      manager: () => ({ renameBranch: async (_p, _c, branch) => branch, hasWork: async () => true }),
      client: async () => ({
        branchName: { generate: async () => ({ data: { branch: ((requests += 1), "replace-custom-name") } }) },
      }),
      settings: () => ({ enabled: true, prefix: "" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "Implement auth" })
    naming.idle("session-1")
    await settle()

    expect(requests).toBe(0)
    expect(state.getWorktree(wt.id)?.branch).toBe("my-custom-branch")
  })

  it("does not start another request while naming is pending", async () => {
    armed(state)
    const first = deferred<{ data: { branch: string | null } }>()
    const renamed: string[] = []
    let requests = 0
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({
        renameBranch: async (_p, _c, branch) => {
          renamed.push(branch)
          return branch
        },
        hasWork: async () => false,
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
    naming.prompt({ sessionID: "session-1", text: "Fix the final task" })
    await settle()
    first.resolve({ data: { branch: "explore-options" } })
    await settle()

    expect(requests).toBe(1)
    expect(renamed).toEqual(["explore-options"])
  })

  it("disarms after the maximum number of prompts without a rename", async () => {
    const wt = armed(state)
    const { naming, requests } = makeNaming(state, {
      generate: async () => ({ data: { branch: null } }),
    })

    for (let i = 0; i < 6; i++) naming.prompt({ sessionID: "session-1", text: `vague ${i}` })
    await settle()

    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
    expect(requests.value).toBeLessThanOrEqual(4)
  })

  it("holds the rename while busy and applies it on idle", async () => {
    const wt = armed(state)
    const { naming, renamed } = makeNaming(state, {
      generate: async () => ({ data: { branch: "fix-thing" } }),
    })

    naming.busy("session-1")
    naming.prompt({ sessionID: "session-1", text: "first" })
    naming.prompt({ sessionID: "session-1", text: "fix the thing" })
    await settle()
    expect(renamed).toEqual([])
    expect(state.getWorktree(wt.id)?.branch).toBe("quiet-river")

    naming.idle("session-1")
    await settle()
    expect(renamed).toEqual(["fix-thing"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("logs a failed rename and stays armed for a retry", async () => {
    const wt = armed(state)
    const logs: string[] = []
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({
        renameBranch: async () => {
          throw new Error("Branch already has an upstream")
        },
        hasWork: async () => false,
      }),
      client: async () => ({
        branchName: { generate: async () => ({ data: { branch: "fix-thing" } }) },
      }),
      settings: () => ({ enabled: true, prefix: "" }),
      push: () => {},
      log: (msg) => logs.push(msg),
    })

    naming.prompt({ sessionID: "session-1", text: "first" })
    naming.prompt({ sessionID: "session-1", text: "fix the thing" })
    await settle()

    expect(logs.some((msg) => msg.includes("Branch already has an upstream"))).toBe(true)
    expect(state.getWorktree(wt.id)).toMatchObject({
      branch: "quiet-river",
      autoNameSessionId: "session-1",
    })
  })

  it("does not generate on idle before any prompt", async () => {
    armed(state)
    const { naming, requests } = makeNaming(state, { hasWork: async () => true })

    naming.idle("session-1")
    await settle()

    expect(requests.value).toBe(0)
  })

  it("generates on prompts two to four and disarms on the fifth", async () => {
    const wt = armed(state)
    const { naming, requests } = makeNaming(state, {
      generate: async () => ({ data: { branch: null } }),
    })

    const counts: number[] = []
    for (let i = 1; i <= 5; i++) {
      naming.prompt({ sessionID: "session-1", text: `message ${i}` })
      await settle()
      counts.push(requests.value)
    }

    expect(counts).toEqual([0, 1, 2, 3, 3])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("holds a rename that resolves while busy and applies it on idle", async () => {
    const wt = armed(state)
    const response = deferred<{ data: { branch: string | null } }>()
    const { naming, renamed } = makeNaming(state, { generate: () => response.promise })

    naming.prompt({ sessionID: "session-1", text: "first" })
    naming.prompt({ sessionID: "session-1", text: "fix the thing" })
    naming.busy("session-1")
    response.resolve({ data: { branch: "fix-thing" } })
    await settle()
    expect(renamed).toEqual([])
    expect(state.getWorktree(wt.id)?.branch).toBe("quiet-river")

    naming.idle("session-1")
    await settle()
    expect(renamed).toEqual(["fix-thing"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("disarms when the setting is disabled", async () => {
    const wt = armed(state)
    const naming = new BranchNamingController({
      state: () => state,
      manager: () => ({ renameBranch: async (_p, _c, branch) => branch, hasWork: async () => true }),
      client: async () => ({ branchName: { generate: async () => ({ data: { branch: "fix-thing" } }) } }),
      settings: () => ({ enabled: false, prefix: "" }),
      push: () => {},
      log: () => {},
    })

    naming.prompt({ sessionID: "session-1", text: "Fix the thing" })
    await settle()

    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
    expect(state.getWorktree(wt.id)?.branch).toBe("quiet-river")
  })
})
