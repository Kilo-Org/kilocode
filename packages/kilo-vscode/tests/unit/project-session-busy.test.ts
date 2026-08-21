import { describe, expect, it } from "bun:test"
import { createSessionBusy } from "../../webview-ui/agent-manager/project/session-busy"

const busy = (statuses: Record<string, { type: string }>) =>
  createSessionBusy({
    statuses: () => statuses,
    permissions: () => [],
    questions: () => [],
    managed: () => [
      { id: "unknown", worktreeId: "wt-unknown" },
      { id: "idle", worktreeId: "wt-idle" },
      { id: "working", worktreeId: "wt-working" },
    ],
    local: () => [],
    projects: () => ({ background: [{ id: "unknown", worktreeId: "wt-unknown" }] }),
    active: () => "project-a",
  })

describe("createSessionBusy", () => {
  it("does not mark stopped or unknown sessions as busy", () => {
    const state = busy({ idle: { type: "idle" } })

    expect(state.agent("wt-unknown")).toBe(false)
    expect(state.agent("wt-idle")).toBe(false)
    expect(state.project("background", "wt-unknown")).toBe(false)
  })

  it("marks sessions with an active status as busy", () => {
    expect(busy({ working: { type: "busy" } }).agent("wt-working")).toBe(true)
  })
})
