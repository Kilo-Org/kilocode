import { describe, expect, it } from "bun:test"
import { createSessionActivity } from "../../webview-ui/agent-manager/project/session-busy"

const activity = (values: Record<string, "waiting" | "error" | "retry" | "busy" | "done" | "idle">) =>
  createSessionActivity({
    managed: () => [
      { id: "current-wt", worktreeId: "wt-current" },
      { id: "current-other", worktreeId: "wt-other" },
      { id: "priority-busy", worktreeId: "wt-priority" },
      { id: "priority-waiting", worktreeId: "wt-priority" },
    ],
    local: () => ["current-local"],
    projects: () => ({
      background: [
        { id: "background-local", worktreeId: null },
        { id: "background-wt", worktreeId: "wt-background" },
      ],
    }),
    active: () => "current",
    activityFor: (id) => values[id] ?? "idle",
  })

describe("createSessionActivity", () => {
  it("returns idle for groups without sessions", () => {
    const state = activity({})

    expect(state.agent("wt-missing")).toBe("idle")
    expect(state.project("background", "wt-missing")).toBe("idle")
  })

  it("scopes local, current, and background project activity", () => {
    const state = activity({
      "current-local": "done",
      "current-wt": "busy",
      "current-other": "error",
      "background-local": "retry",
      "background-wt": "error",
    })

    expect(state.local()).toBe("done")
    expect(state.project("current", null)).toBe("done")
    expect(state.project("current", "wt-current")).toBe("busy")
    expect(state.project("background", null)).toBe("retry")
    expect(state.project("background", "wt-background")).toBe("error")
  })

  it("prioritizes attention over errors and work in a group", () => {
    const state = activity({
      "current-wt": "busy",
      "current-other": "waiting",
      "priority-busy": "busy",
      "priority-waiting": "waiting",
      "background-local": "error",
      "background-wt": "waiting",
    })

    expect(state.agent("wt-priority")).toBe("waiting")
    expect(state.project("current", "wt-other")).toBe("waiting")
    expect(state.project("background", "wt-background")).toBe("waiting")
  })
})
