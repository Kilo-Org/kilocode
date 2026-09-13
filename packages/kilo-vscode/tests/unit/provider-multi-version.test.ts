import { describe, expect, it, mock } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { createMultiVersion, type MultiVersionHost } from "../../src/agent-manager/provider-multi-version"
import type { ProjectContext } from "../../src/agent-manager/project/context"
import type { CreateWorktreeOnDiskResult } from "../../src/agent-manager/worktree-create"

describe("multi-version provisioning", () => {
  it.each([
    { name: "Fix login", branches: ["fix-login", "fix-login-v2"] },
    { name: "!!!", branches: [undefined, "v2"] },
    { name: "a".repeat(60), branches: ["a".repeat(50), "a".repeat(50)] },
    { name: undefined, branches: [undefined, undefined] },
    { name: "Fix login", branchName: "Feature/My_fix.v2", branches: ["Feature/My_fix.v2", "Feature/My_fix.v2_v2"] },
    { name: "Fix login", branchName: " invalid ", branches: [" invalid ", " invalid _v2"] },
  ])("keeps automatic display-name slugging separate from explicit refs: %j", async (input) => {
    const create = mock(async (_opts: { branchName?: string }) => null)
    const host = {
      createOnDisk: create,
      log: () => {},
      post: () => {},
      error: () => {},
    } as unknown as MultiVersionHost
    await createMultiVersion({ id: "project-1" } as ProjectContext, host, {
      type: "agentManager.createMultiVersion",
      versions: 2,
      name: input.name,
      branchName: "branchName" in input ? input.branchName : undefined,
    })
    expect(create.mock.calls.map(([opts]) => opts.branchName)).toEqual(input.branches)
  })

  it("finishes git creation before provisioning at bounded concurrency", async () => {
    const flow: string[] = []
    const gates = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const entered = [Promise.withResolvers<void>(), Promise.withResolvers<void>()]
    const state = { addSession: mock(() => {}), armAutoName: mock(() => {}) }
    const ctx = {
      id: "project-1",
      stateManager: () => state,
      peekState: () => state,
      worktreeManager: () => ({ removeWorktree: mock(async () => {}) }),
    } as unknown as ProjectContext
    const host = {
      log: mock(() => {}),
      post: mock((msg: { type: string; sessionId?: string }) => {
        if (msg.type === "agentManager.sendInitialMessage") flow.push(`prompt:${msg.sessionId}`)
      }),
      createOnDisk: mock(async (opts: { branchName?: string }) => {
        const index = opts.branchName?.endsWith("_v2") ? 1 : opts.branchName?.endsWith("_v3") ? 2 : 0
        flow.push(`git:${index}`)
        return {
          worktree: { id: `wt-${index}` },
          result: { path: `/repo/wt-${index}`, branch: `branch-${index}`, parentBranch: "main" },
        } as CreateWorktreeOnDiskResult
      }),
      runSetup: mock(async (dir: string) => {
        const index = Number(dir.at(-1)!)
        flow.push(`setup:${index}`)
        if (index < 2) {
          entered[index]?.resolve()
          await gates[index]?.promise
        }
      }),
      createSession: mock(async (dir: string) => ({ id: `session-${dir.at(-1)!}` }) as Session),
      autoName: () => ({ enabled: false }),
      register: mock(() => {}),
      notifyReady: mock(() => {}),
      sessions: { register: mock(() => {}) },
      promptName: mock(() => {}),
      capture: mock(() => {}),
      error: mock(() => {}),
    } as unknown as MultiVersionHost

    const pending = createMultiVersion(ctx, host, {
      type: "agentManager.createMultiVersion",
      text: "Fix it",
      branchName: "fix-it",
      versions: 3,
    })
    await Promise.all(entered.map((entry) => entry.promise))

    expect(flow.slice(0, 5)).toEqual(["git:0", "git:1", "git:2", "setup:0", "setup:1"])
    expect(flow).not.toContain("setup:2")

    gates.forEach((gate) => gate.resolve())
    await pending

    expect(flow).toContain("setup:2")
    expect(flow.filter((event) => event.startsWith("prompt:"))).toHaveLength(3)
  })

  it("uses the detailed no-commit error in the final notification", async () => {
    const message = "This repository has no commits yet. Create an initial commit before using worktrees."
    const error = mock(() => {})
    const host = {
      createOnDisk: mock(async (opts: { onError?: (failure: { message: string; code?: string }) => void }) => {
        opts.onError?.({ message, code: "no_commits" })
        return null
      }),
      log: () => {},
      post: () => {},
      error,
    } as unknown as MultiVersionHost

    await createMultiVersion({ id: "project-1" } as ProjectContext, host, {
      type: "agentManager.createMultiVersion",
      versions: 1,
    })

    expect(error).toHaveBeenCalledWith(message)
  })

  it("keeps the generic notification for other failures", async () => {
    const error = mock(() => {})
    const host = {
      createOnDisk: mock(async (opts: { onError?: (failure: { message: string }) => void }) => {
        opts.onError?.({ message: "Branch already exists" })
        return null
      }),
      log: () => {},
      post: () => {},
      error,
    } as unknown as MultiVersionHost

    await createMultiVersion({ id: "project-1" } as ProjectContext, host, {
      type: "agentManager.createMultiVersion",
      versions: 1,
    })

    expect(error).toHaveBeenCalledWith("Failed to create any of the 1 multi-version worktrees.")
  })
})
