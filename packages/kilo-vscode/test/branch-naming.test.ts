import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { KiloBranchNameRpc } from "@opencode/schema/kilocode/branch-name"
import { BranchNamingController } from "../src/agent-manager/branch-naming"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 20))
}

function makeNaming(
  state: WorktreeStateManager,
  deps: {
    generate?: (input: { sessionID: string; prompt: string }) => Promise<{ branch: string | null }>
    hasWork?: () => Promise<boolean>
    prefix?: string
  } = {},
) {
  const renamed: string[] = []
  const prompts: string[] = []
  const requests = { value: 0 }
  const generate = deps.generate ?? (() => Promise.resolve({ branch: null }))
  const naming = new BranchNamingController({
    state: () => state,
    manager: () => ({
      renameBranch: async (_p: string, _c: string, branch: string) => {
        renamed.push(branch)
        return branch
      },
      hasWork: async () => (deps.hasWork ? await deps.hasWork() : false),
    }),
    client: async () =>
      ({
        rpc: (definition: unknown) => {
          expect(definition).toBe(KiloBranchNameRpc.Definition)
          return {
            generate: async (input: { sessionID: string; prompt: string }) => {
              requests.value += 1
              prompts.push(input.prompt)
              return generate(input)
            },
          }
        },
      }) as never,
    settings: () => ({ enabled: true, prefix: deps.prefix ?? "" }),
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
    fs.mkdirSync(path.join(root, ".kilo2"), { recursive: true })
    state = new WorktreeStateManager(root, () => {})
  })

  afterEach(async () => {
    await state.flush()
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("skips the first prompt and names on the second", async () => {
    const wt = armed(state)
    const { naming, renamed, prompts, requests } = makeNaming(state, {
      generate: async () => ({ branch: "fix-final-task" }),
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
      generate: async () => ({ branch: "fix-token-refresh-race" }),
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

  it("holds the generated name while the session is busy", async () => {
    const wt = armed(state)
    const { naming, renamed } = makeNaming(state, {
      generate: async () => ({ branch: "fix-busy" }),
    })

    naming.prompt({ sessionID: "session-1", text: "one" })
    naming.prompt({ sessionID: "session-1", text: "two" })
    naming.busy("session-1")
    await settle()
    expect(renamed).toEqual([])

    naming.idle("session-1")
    await settle()
    expect(renamed).toEqual(["fix-busy"])
    expect(state.getWorktree(wt.id)?.autoNameSessionId).toBeUndefined()
  })

  it("applies the user prefix", async () => {
    armed(state)
    const { naming, renamed } = makeNaming(state, {
      generate: async () => ({ branch: "fix-token-refresh-race" }),
      hasWork: async () => true,
      prefix: "Marius / Features",
    })

    naming.prompt({ sessionID: "session-1", text: "Fix the token refresh race" })
    naming.idle("session-1")
    await settle()

    expect(renamed).toEqual(["marius/features/fix-token-refresh-race"])
  })

  it("leaves a worktree whose branch it does not own", async () => {
    const wt = state.addWorktree({
      branch: "user-branch",
      path: "/tmp/user-branch",
      parentBranch: "main",
      branchOwned: false,
    })
    state.addSession("session-1", wt.id)
    state.armAutoName(wt.id, "session-1")
    const { naming, renamed } = makeNaming(state, {
      generate: async () => ({ branch: "should-not-apply" }),
    })

    naming.prompt({ sessionID: "session-1", text: "one" })
    naming.prompt({ sessionID: "session-1", text: "two" })
    await settle()

    expect(renamed).toEqual([])
    expect(state.getWorktree(wt.id)?.branch).toBe("user-branch")
  })
})