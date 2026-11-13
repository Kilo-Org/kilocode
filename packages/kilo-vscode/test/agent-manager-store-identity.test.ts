import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createProjectStore, keepUnchanged } from "../webview-ui/agent-manager/project/store"
import type { AgentManagerStateMessage, WorktreeState } from "../webview-ui/src/types/messages/agent-manager"

function tree(id: string, values: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id,
    branch: `feature/${id}`,
    path: `/repo/.kilo/worktrees/${id}`,
    parentBranch: "main",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...values,
  }
}

function push(worktrees: WorktreeState[], order: string[]): AgentManagerStateMessage {
  return {
    type: "agentManager.state",
    worktrees,
    sessions: [{ id: "ses_a", worktreeId: "a", createdAt: "2026-08-01T00:00:00.000Z" }],
    sections: [{ id: "s", name: "Section", color: null, order: 0, collapsed: false }],
    worktreeOrder: order,
  } as AgentManagerStateMessage
}

describe("keepUnchanged", () => {
  it("keeps the previous list when every item is unchanged", () => {
    const prev = [tree("a"), tree("b")]
    expect(keepUnchanged(prev, [tree("a"), tree("b")])).toBe(prev)
  })

  it("keeps unchanged items and takes changed, added and reordered ones", () => {
    const prev = [tree("a"), tree("b")]
    const next = keepUnchanged(prev, [tree("b", { label: "Renamed" }), tree("a"), tree("c")])
    expect(next).not.toBe(prev)
    expect(next[0]).not.toBe(prev[1])
    expect(next[0]?.label).toBe("Renamed")
    expect(next[1]).toBe(prev[0])
    expect(next[2]?.id).toBe("c")
  })

  it("treats a removed optional field as a change", () => {
    const prev = [tree("a", { pinned: true })]
    expect(keepUnchanged(prev, [tree("a")])[0]).not.toBe(prev[0])
  })
})

describe("project store state push", () => {
  it("keeps the identity of unchanged rows across pushes", () => {
    createRoot((dispose) => {
      const store = createProjectStore("project")
      store.applyState(push([tree("a"), tree("b")], ["a", "b"]))
      const worktrees = store.worktrees()
      const sessions = store.managedSessions()
      const sections = store.sections()
      const order = store.worktreeOrder()

      store.applyState(push([tree("a"), tree("b")], ["a", "b"]))
      expect(store.worktrees()).toBe(worktrees)
      expect(store.managedSessions()).toBe(sessions)
      expect(store.sections()).toBe(sections)
      expect(store.worktreeOrder()).toBe(order)

      store.applyState(push([tree("a"), tree("b", { pinned: true })], ["b", "a"]))
      expect(store.worktrees()[0]).toBe(worktrees[0])
      expect(store.worktrees()[1]?.pinned).toBe(true)
      expect(store.worktreeOrder()).toEqual(["b", "a"])
      dispose()
    })
  })
})
