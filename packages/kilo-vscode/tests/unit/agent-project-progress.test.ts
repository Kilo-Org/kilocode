import { describe, expect, it } from "bun:test"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import { clearMultiVersionBusy, markMultiVersionBusy } from "../../webview-ui/agent-manager/project/progress"

const state = (projectId: string) => ({
  type: "agentManager.state" as const,
  projectId,
  worktrees: [
    {
      id: "same",
      branch: `${projectId}-same`,
      path: `/repo/${projectId}/same`,
      parentBranch: "main",
      createdAt: "2026-01-01",
      groupId: "group",
    },
  ],
  sessions: [{ id: `${projectId}-session`, worktreeId: "same", createdAt: "2026-01-01" }],
  sections: [],
})

describe("multi-project progress state", () => {
  it("updates only the owning project's grouped worktrees", () => {
    const first = createProjectStore("a")
    const second = createProjectStore("b")
    first.applyState(state("a"))
    second.applyState(state("b"))
    first.setBusy(new Map([["same", { reason: "setting-up" as const }]]))
    second.setBusy(new Map([["same", { reason: "setting-up" as const }]]))

    clearMultiVersionBusy(second, "group")

    expect(first.busy().has("same")).toBe(true)
    expect(second.busy().has("same")).toBe(false)

    second.setBusy(new Map([["same", { reason: "deleting" as const }]]))
    clearMultiVersionBusy(second, "group")
    expect(second.busy().get("same")?.reason).toBe("deleting")
  })

  it("marks a newly created grouped worktree as busy in its project store", () => {
    const store = createProjectStore("a")
    store.applyState(state("a"))

    markMultiVersionBusy(store, "a-session")

    expect(store.busy().get("same")?.reason).toBe("setting-up")
  })

  it("does not replace deletion progress when marking a grouped worktree", () => {
    const store = createProjectStore("a")
    store.applyState(state("a"))
    store.setBusy(new Map([["same", { reason: "deleting" as const }]]))

    markMultiVersionBusy(store, "a-session")

    expect(store.busy().get("same")?.reason).toBe("deleting")
  })
})
