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
  it("preserves temporary tab positions when durable order is pushed again", () => {
    const store = createProjectStore("a")
    const order = ["terminal:second", "ses-2", "review", "pending:draft", "ses-1", "terminal:first"]
    store.setTabOrder({ local: order })
    store.applyState({ ...state("a", []), tabOrder: { local: ["ses-2", "ses-1"] } })
    expect(store.tabOrder().local).toEqual(order)
    store.applyState({ ...state("a", []), tabOrder: { local: ["ses-2", "ses-1"] } })
    expect(store.tabOrder().local).toEqual(order)
  })

  it("accepts durable changes without dropping temporary tabs", () => {
    const store = createProjectStore("a")
    store.setTabOrder({ local: ["ses-1", "terminal:1", "ses-2", "review"] })
    store.applyState({ ...state("a", []), tabOrder: { local: ["ses-2", "ses-3"] } })
    expect(store.tabOrder().local).toEqual(["terminal:1", "ses-2", "review", "ses-3"])
  })

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

  it("keeps busy worktrees isolated between projects", () => {
    const first = createProjectStore("a")
    const second = createProjectStore("b")
    first.applyState(state("a", ["same"]))
    second.applyState(state("b", ["same"]))

    first.setBusy(new Map([["same", { reason: "setting-up" as const }]]))

    expect(first.busy().has("same")).toBe(true)
    expect(second.busy().has("same")).toBe(false)
  })
})
