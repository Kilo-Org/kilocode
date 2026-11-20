import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

describe("Agent Manager v2 state import", () => {
  let root: string
  let legacy: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-state-import-"))
    legacy = path.join(root, ".kilo", "agent-manager.json")
    fs.mkdirSync(path.dirname(legacy), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  })

  it("uses v1 associations in place and persists edits to that same state file", async () => {
    const content = JSON.stringify({
      worktrees: {
        "wt-1": {
          branch: "feature",
          path: path.join(root, "worktree"),
          parentBranch: "main",
          createdAt: 1,
        },
      },
      sessions: { "ses-1": { worktreeId: "wt-1", createdAt: 2 } },
      reviewDiffStyle: "split",
      sessionsCollapsed: true,
    })
    fs.writeFileSync(legacy, content)

    const state = new WorktreeStateManager(root, () => undefined)
    const loaded = await state.load()

    expect(loaded.status).toBe("loaded")
    expect(state.getWorktrees().map((wt) => wt.id)).toEqual(["wt-1"])
    expect(state.getSessions("wt-1").map((session) => session.id)).toEqual(["ses-1"])
    expect(state.getReviewDiffStyle()).toBe("split")
    expect(state.getSessionsCollapsed()).toBe(true)
    expect(fs.readFileSync(legacy, "utf8")).toBe(content)
    state.removeWorktree("wt-1")
    await state.flush()
    const reloaded = new WorktreeStateManager(root, () => {})
    expect((await reloaded.load()).status).toBe("loaded")
    expect(reloaded.getWorktrees()).toEqual([])
  })

  it("reports a missing state when neither file exists", async () => {
    const state = new WorktreeStateManager(root, () => undefined)
    expect((await state.load()).status).toBe("missing")
  })
})
