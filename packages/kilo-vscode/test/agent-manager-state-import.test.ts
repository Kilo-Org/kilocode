import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"

describe("Agent Manager v2 state import", () => {
  let root: string
  let legacy: string
  let target: string

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "am-state-import-"))
    legacy = path.join(root, ".kilo", "agent-manager.json")
    target = path.join(root, ".kilo2", "agent-manager.json")
    fs.mkdirSync(path.dirname(legacy), { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true })
  })

  it("imports the v1 state file once and leaves it untouched", async () => {
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
    const written = JSON.parse(fs.readFileSync(target, "utf8"))
    expect(written.version).toBe(1)
    expect(Object.keys(written.worktrees)).toEqual(["wt-1"])
  })

  it("loads the v2 file afterwards and does not re-import the v1 file", async () => {
    fs.writeFileSync(
      legacy,
      JSON.stringify({ worktrees: { old: { branch: "old", path: path.join(root, "old") } }, sessions: {} }),
    )
    const first = new WorktreeStateManager(root, () => undefined)
    await first.load()
    first.removeWorktree("old")
    await first.flush()

    fs.writeFileSync(
      legacy,
      JSON.stringify({ worktrees: { fresh: { branch: "fresh", path: path.join(root, "fresh") } }, sessions: {} }),
    )
    const second = new WorktreeStateManager(root, () => undefined)
    const loaded = await second.load()

    expect(loaded.status).toBe("loaded")
    expect(second.getWorktrees()).toEqual([])
    expect(JSON.parse(fs.readFileSync(target, "utf8")).version).toBe(1)
  })

  it("reports a missing state when neither file exists", async () => {
    const state = new WorktreeStateManager(root, () => undefined)
    expect((await state.load()).status).toBe("missing")
  })
})