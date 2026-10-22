import { describe, expect, it } from "bun:test"
import path from "node:path"
import { createWorktreeRecency } from "../../webview-ui/agent-manager/worktree-recency"

function storage(value: Record<string, unknown> = {}) {
  const state = { value, writes: 0 }
  return {
    get: () => state.value,
    set: (value: Record<string, unknown>) => {
      state.value = value
      state.writes++
    },
    state,
  }
}

describe("worktree mention recency", () => {
  it("tracks real selection changes and project-scoped session metadata", () => {
    const file = path.join(import.meta.dir, "../fixtures/worktree-references.ts")
    const child = Bun.spawnSync(["bun", "--conditions=browser", file], { stdout: "pipe", stderr: "pipe" })
    expect(child.exitCode, child.stdout.toString() + child.stderr.toString()).toBe(0)
  })

  it("keeps the most recently opened worktree first without duplicate visits", () => {
    const data = storage()
    const history = createWorktreeRecency(data)
    history.visit("/repo/first")
    history.visit("/repo/second")
    history.visit("/repo/first")
    expect(history.recent()).toEqual(["/repo/first", "/repo/second"])
    expect(data.get().worktreeMentionHistory).toEqual(history.recent())
    history.visit("/repo/first")
    history.visit("")
    expect(data.state.writes).toBe(3)
  })

  it("restores visits across picker and webview recreation", () => {
    const data = storage()
    const first = createWorktreeRecency(data)
    first.visit("/repo/first")
    first.visit("/repo/second")
    const restored = createWorktreeRecency(data)
    expect(restored.recent()).toEqual(["/repo/second", "/repo/first"])
    restored.visit("/repo/first")
    expect(restored.recent()).toEqual(["/repo/first", "/repo/second"])
  })

  it("preserves unrelated webview state and uses paths rather than ambiguous IDs", () => {
    const data = storage({ sidebarWidth: 240, localTabs: { project: ["ses_one"] } })
    const history = createWorktreeRecency(data)
    history.visit("/first/.kilo/worktrees/same")
    data.state.value = { ...data.get(), sidebarWidth: 300 }
    history.visit("/second/.kilo/worktrees/same")
    expect(history.recent()).toEqual(["/second/.kilo/worktrees/same", "/first/.kilo/worktrees/same"])
    expect(data.get()).toEqual({
      sidebarWidth: 300,
      localTabs: { project: ["ses_one"] },
      worktreeMentionHistory: history.recent(),
    })
  })

  it("ignores invalid saved entries and bounds the history", () => {
    const data = storage({ worktreeMentionHistory: [null, 42, "", "/repo/one", "/repo/one", "/repo/two"] })
    expect(createWorktreeRecency(data).recent()).toEqual(["/repo/one", "/repo/two"])
    expect(createWorktreeRecency(storage({ worktreeMentionHistory: "invalid" })).recent()).toEqual([])
    const many = storage({ worktreeMentionHistory: Array.from({ length: 110 }, (_, index) => `/repo/${index}`) })
    const history = createWorktreeRecency(many)
    expect(history.recent()).toHaveLength(100)
    history.visit("/repo/new")
    expect(history.recent()).toHaveLength(100)
    expect(history.recent()[0]).toBe("/repo/new")
    expect(history.recent()).not.toContain("/repo/99")
  })
})
