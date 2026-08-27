import { describe, expect, it } from "bun:test"
import { createSessionActivity, createWorktreeActivity } from "../../webview-ui/agent-manager/project/session-busy"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"
import type { Activity } from "../../webview-ui/src/utils/session-activity"

const options = (values: Record<string, Activity>) => ({
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
  activityFor: (id: string) => values[id] ?? "idle",
  inUseFor: (id: string) => ["busy", "retry", "waiting"].includes(values[id] ?? "idle"),
})
const activity = (values: Record<string, Activity>) => createSessionActivity(options(values))

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

describe("createWorktreeActivity", () => {
  it("keeps directory activity separate from parent status and other projects", () => {
    const listeners = new Set<(message: ExtensionMessage) => void>()
    const state = createWorktreeActivity({
      ...options({ "current-wt": "done", "current-other": "busy", "current-local": "done" }),
      worktrees: (project) => [
        { id: "wt-current", path: project === "background" ? "/other/worktree" : "/repo/worktree" },
      ],
      subscribe: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    })
    const send = (active: string[]) => {
      for (const callback of listeners) callback({ type: "agentManager.worktreeActivity", active })
    }
    expect(state.agent("wt-current")).toBe("done")
    expect(state.blocked("wt-current")).toBe(false)
    expect(state.agent("wt-other")).toBe("busy")
    send(["/repo/worktree"])
    expect(state.agent("wt-current")).toBe("busy")
    expect(state.blocked("wt-current")).toBe(true)
    expect(state.project("current", "wt-current")).toBe("busy")
    expect(state.project("background", "wt-current")).toBe("idle")
    expect(state.blocked("wt-current", "background")).toBe(false)
    expect(state.project("background", null)).toBe("idle")
    expect(state.agent("missing")).toBe("idle")
    expect(state.local()).toBe("done")
    send(["/other/worktree"])
    expect(state.agent("wt-current")).toBe("done")
    expect(state.blocked("wt-current")).toBe(false)
    expect(state.project("background", "wt-current")).toBe("busy")
    expect(state.blocked("wt-current", "background")).toBe(true)
    send([])
    expect(state.project("background", "wt-current")).toBe("idle")
    expect(state.blocked("wt-current", "background")).toBe(false)
    expect(state.agent("wt-other")).toBe("busy")
  })

  it.each(["waiting", "error", "retry"] as const)("does not hide %s behind directory activity", (value) => {
    const listeners = new Set<(message: ExtensionMessage) => void>()
    const state = createWorktreeActivity({
      ...options({ "current-wt": value }),
      worktrees: () => [{ id: "wt-current", path: "/repo/worktree" }],
      subscribe: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    })
    for (const callback of listeners) callback({ type: "agentManager.worktreeActivity", active: ["/repo/worktree"] })
    expect(state.agent("wt-current")).toBe(value)
    expect(state.project("current", "wt-current")).toBe(value)
  })

  it.each(["idle", "waiting", "error"] as const)("keeps deletion guards independent of the %s icon", (value) => {
    let pending = true
    const state = createWorktreeActivity({
      ...options({ "current-wt": value }),
      inUseFor: (id) => id === "current-wt" && pending,
      projects: () => ({ other: [{ id: "current-wt", worktreeId: "wt-current" }] }),
      worktrees: () => [],
      subscribe: () => () => undefined,
    })
    expect(state.agent("wt-current")).toBe(value)
    expect(state.blocked("wt-current")).toBe(true)
    expect(state.blocked("wt-current", "current")).toBe(true)
    expect(state.blocked("wt-current", "other")).toBe(true)
    expect(state.blocked("missing")).toBe(false)
    pending = false
    expect(state.blocked("wt-current")).toBe(false)
    expect(state.blocked("wt-current", "other")).toBe(false)
  })
})
