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
function make() {
  const builds: { id: string; ctx: PanelContext }[] = []
  const catalog = {
    build: (id: string, ctx: PanelContext): DiffSource => {
      builds.push({ id, ctx })
      return {
        descriptor: { id, type: "workspace", group: "Git", capabilities: { revert: true, comments: true } },
        async fetch() {
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
    post: () => {},
    log: () => {},
  })
  return { controller, builds }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (cond()) return
    await tick()
  }
  throw new Error("waitFor timed out")
}

describe("WorktreeDiffController.setBase", () => {
  it("rebuilds the active source against the overridden base branch", async () => {
    const { controller, builds } = make()
    controller.start("s1#branch")
    await waitFor(() => builds.length === 1)
    expect(builds[0]!.ctx.dir).toBe("/wt")
    expect(builds[0]!.ctx.baseBranch).toBe("origin/main")

    await controller.setBase("s1#branch", "feature-x")
    expect(builds.length).toBe(2)
    expect(builds[1]!.ctx.dir).toBe("/wt")
    expect(builds[1]!.ctx.baseBranch).toBe("feature-x")

    // Clearing the override falls back to the recorded parent ref.
    await controller.setBase("s1#branch", undefined)
    expect(builds.length).toBe(3)
    expect(builds[2]!.ctx.baseBranch).toBe("origin/main")

    controller.stop()
  })

  it("stores the override without rebuilding when the context isn't active", async () => {
    const { controller, builds } = make()

    await controller.setBase("s1#branch", "feature-x")
    expect(builds.length).toBe(0)

    // The next activation of that context resolves the stored override.
    controller.start("s1#branch")
    await waitFor(() => builds.length === 1)
    expect(builds[0]!.ctx.baseBranch).toBe("feature-x")

    controller.stop()
  })
})
