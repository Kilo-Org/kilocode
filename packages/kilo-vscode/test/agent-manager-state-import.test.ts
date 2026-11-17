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
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
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

  it("adds the recent v1 sessions an existing v2 state does not have, with their worktrees", async () => {
    const kept = path.join(root, "kept")
    const gone = path.join(root, "gone")
    fs.mkdirSync(kept)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(
      target,
      JSON.stringify({
        worktrees: {},
        sessions: { "ses-v2": { worktreeId: null, createdAt: "2026-11-01T00:00:00Z" } },
      }),
    )
    fs.writeFileSync(
      legacy,
      JSON.stringify({
        worktrees: {
          "wt-kept": { branch: "kept", path: kept, parentBranch: "main", createdAt: "2026-11-01T00:00:00Z" },
          "wt-gone": { branch: "gone", path: gone, parentBranch: "main", createdAt: "2026-11-01T00:00:00Z" },
        },
        sessions: {
          "ses-recent": { worktreeId: "wt-kept", createdAt: "2026-11-10T00:00:00Z" },
          "ses-local": { worktreeId: null, createdAt: "2026-11-10T00:00:00Z" },
          "ses-gone": { worktreeId: "wt-gone", createdAt: "2026-11-10T00:00:00Z" },
          "ses-old": { worktreeId: "wt-kept", createdAt: "2026-10-01T00:00:00Z" },
          "ses-v2": { worktreeId: "wt-kept", createdAt: "2026-11-10T00:00:00Z" },
          "ses-unknown": { worktreeId: null, createdAt: "2026-11-10T00:00:00Z" },
        },
      }),
    )
    const state = new WorktreeStateManager(root, () => undefined)
    await state.load()
    const exists = async (id: string) => id !== "ses-unknown"

    expect(await state.importLegacySessions(Date.parse("2026-11-05T00:00:00Z"), exists)).toBe(2)
    const worktree = state.findWorktreeByPath(kept)
    expect(worktree?.branch).toBe("kept")
    expect(state.getSessions(worktree?.id).map((session) => session.id)).toEqual(["ses-recent"])
    expect(state.getSessions().find((session) => session.id === "ses-v2")?.worktreeId).toBeNull()
    expect(state.getSessions().find((session) => session.id === "ses-local")?.worktreeId).toBeNull()
    expect(state.findWorktreeByPath(gone)).toBeUndefined()
    expect(await state.importLegacySessions(Date.parse("2026-11-05T00:00:00Z"), exists)).toBe(0)
    await state.flush()
    expect(Object.keys(JSON.parse(fs.readFileSync(target, "utf8")).sessions).sort()).toEqual([
      "ses-local",
      "ses-recent",
      "ses-v2",
    ])
  })

  it("reports a missing state when neither file exists", async () => {
    const state = new WorktreeStateManager(root, () => undefined)
    expect((await state.load()).status).toBe("missing")
  })
})
