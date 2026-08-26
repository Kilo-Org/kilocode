import { describe, it, expect } from "bun:test"
import { WorktreeDiffController } from "../../src/agent-manager/worktree-diff-controller"
import type { DiffSourceCatalog } from "../../src/diff/sources/catalog"
import type { DiffSource } from "../../src/diff/sources/types"
import type { PanelContext } from "../../src/diff/types"
import type { GitOps } from "../../src/agent-manager/GitOps"
import type { WorktreeStateManager } from "../../src/agent-manager/WorktreeStateManager"

// Records every PanelContext handed to catalog.build so tests can assert which
// base branch the active source was (re)built with. The controller, scope
// resolution, and SourceController lifecycle under test are all real.
// Contexts are worktree ids (the sidebar selection), not session ids.
function make(onFetch?: (n: number) => Promise<void>, project?: () => string | undefined) {
  const builds: { id: string; ctx: PanelContext }[] = []
  const posted: unknown[] = []
  let fetches = 0
  const catalog = {
    build: (id: string, ctx: PanelContext): DiffSource => {
      builds.push({ id, ctx })
      return {
        descriptor: { id, type: "workspace", group: "Git", capabilities: { revert: true, comments: true } },
        async fetch() {
          await onFetch?.(++fetches)
          return { diffs: [] }
        },
      }
    },
  } as unknown as DiffSourceCatalog

  const state = {
    getSession: (id: string) => (id === "s1" ? { id: "s1", worktreeId: "w1", createdAt: "" } : undefined),
    getWorktree: (id: string) =>
      id === "w1" ? { id: "w1", path: "/wt", parentBranch: "main", remote: "origin" } : undefined,
  } as unknown as WorktreeStateManager

  const controller = new WorktreeDiffController({
    getState: () => state,
    getRoot: () => "/repo",
    getStateReady: () => undefined,
    catalog,
    git: {} as GitOps,
    localDiffFile: async () => null,
    post: (message) => posted.push(message),
    log: () => {},
    projectId: project,
  })
  return { controller, builds, posted }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (cond()) return
    await tick()
  }
  throw new Error("waitFor timed out")
}

describe("WorktreeDiffController.requestFiles", () => {
  it("completes every file when the requested composite scope is inactive", async () => {
    const { controller, posted } = make()
    await controller.requestFiles(undefined, "w1#branch", ["one.ts", "two.ts"])
    expect(posted).toEqual([
      {
        type: "agentManager.worktreeDiffFile",
        projectId: undefined,
        sessionId: "w1#branch",
        file: "one.ts",
        diff: null,
      },
      {
        type: "agentManager.worktreeDiffFile",
        projectId: undefined,
        sessionId: "w1#branch",
        file: "two.ts",
        diff: null,
      },
    ])
    controller.stop()
  })

  it("rejects a colliding composite scope owned by another project", async () => {
    const { controller, builds, posted } = make(undefined, () => "project-a")
    controller.start("w1#branch")
    await waitFor(() => builds.length === 1)
    posted.length = 0
    await controller.requestFiles("project-b", "w1#branch", ["one.ts", "two.ts"])

    expect(posted).toEqual([
      {
        type: "agentManager.worktreeDiffFile",
        projectId: "project-b",
        sessionId: "w1#branch",
        file: "one.ts",
        diff: null,
      },
      {
        type: "agentManager.worktreeDiffFile",
        projectId: "project-b",
        sessionId: "w1#branch",
        file: "two.ts",
        diff: null,
      },
    ])
    controller.stop()
  })

  it("rejects requests when the active project changes after source activation", async () => {
    let project = "project-a"
    const { controller, builds, posted } = make(undefined, () => project)
    controller.start("w1#branch")
    await waitFor(() => builds.length === 1)
    posted.length = 0
    project = "project-b"
    await controller.requestFiles("project-a", "w1#branch", ["one.ts"])

    expect(posted).toEqual([
      {
        type: "agentManager.worktreeDiffFile",
        projectId: "project-a",
        sessionId: "w1#branch",
        file: "one.ts",
        diff: null,
      },
    ])
    controller.stop()
  })
})

describe("WorktreeDiffController.setBase", () => {
  it("rebuilds the active source against the overridden base branch", async () => {
    const { controller, builds } = make()
    controller.start("w1#branch")
    await waitFor(() => builds.length === 1)
    expect(builds[0]!.ctx.dir).toBe("/wt")
    expect(builds[0]!.ctx.baseBranch).toBe("origin/main")

    await controller.setBase("w1#branch", "feature-x")
    expect(builds.length).toBe(2)
    expect(builds[1]!.ctx.dir).toBe("/wt")
    expect(builds[1]!.ctx.baseBranch).toBe("feature-x")

    // Clearing the override falls back to the recorded parent ref.
    await controller.setBase("w1#branch", undefined)
    expect(builds.length).toBe(3)
    expect(builds[2]!.ctx.baseBranch).toBe("origin/main")

    controller.stop()
  })

  it("stores the override without rebuilding when the context isn't active", async () => {
    const { controller, builds } = make()

    await controller.setBase("w1#branch", "feature-x")
    expect(builds.length).toBe(0)

    // The next activation of that context resolves the stored override.
    controller.start("w1#branch")
    await waitFor(() => builds.length === 1)
    expect(builds[0]!.ctx.baseBranch).toBe("feature-x")

    controller.stop()
  })

  it("keeps watching when the base changes during the initial fetch", async () => {
    // Hold the first activation's fetch in flight, simulating a slow worktree
    // diff. isPolling is still false in this window, but the watch intent must
    // survive the base change rather than downgrading the panel to one-shot.
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    const { controller, builds } = make(async (n) => {
      if (n === 1) await gate
    })

    controller.start("w1#branch")
    await waitFor(() => builds.length === 1)

    const change = controller.setBase("w1#branch", "feature-x")
    release()
    await change
    expect(builds.length).toBe(2)
    expect(builds[1]!.ctx.baseBranch).toBe("feature-x")

    // Polling survives: start() early-returns for an id that is already
    // watched. A downgraded one-shot panel would re-activate and rebuild here.
    controller.start("w1#branch")
    await tick()
    expect(builds.length).toBe(2)

    controller.stop()
  })
})
