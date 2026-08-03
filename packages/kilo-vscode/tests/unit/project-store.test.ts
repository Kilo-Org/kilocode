import { describe, expect, it } from "bun:test"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"

const state = (projectId: string, order: string[]) => ({
  type: "agentManager.state" as const,
  projectId,
  worktrees: order.map((id) => ({
    id,
    branch: `${projectId}-${id}`,
    path: `/repo/${projectId}/${id}`,
    parentBranch: "main",
    createdAt: "2026-01-01",
  })),
  sessions: [],
  sections: [],
  worktreeOrder: order,
})

describe("project stores", () => {
  it("keeps worktree order isolated between projects", () => {
    const first = createProjectStore("a")
    const second = createProjectStore("b")
    first.applyState(state("a", ["same", "other"]))
    second.applyState(state("b", ["same", "other"]))

    first.setWorktreeOrder(["other", "same"])

    expect(first.worktreeOrder()).toEqual(["other", "same"])
    expect(second.worktreeOrder()).toEqual(["same", "other"])
  })

  it("preserves live run statuses when state omits them", () => {
    const store = createProjectStore("a")
    store.applyState(state("a", ["same", "other"]))
    store.setRunStatuses({
      same: { worktreeId: "same", state: "running" },
    })

    store.applyState(state("a", ["other", "same"]))

    expect(store.runStatuses()).toEqual({
      same: { worktreeId: "same", state: "running" },
    })
  })
})
