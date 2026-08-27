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

  it.each(["permission", "question"] as const)(
    "blocks deletion for a pending %s without showing a running spinner",
    (kind) => {
      const state = createSessionBusy({
        statuses: () => ({ session: { type: "busy" } }),
        permissions: () => (kind === "permission" ? [{ sessionID: "session" }] : []),
        questions: () => (kind === "question" ? [{ sessionID: "session" }] : []),
        managed: () => [{ id: "session", worktreeId: "worktree" }],
        local: () => [],
        projects: () => ({ other: [{ id: "session", worktreeId: "worktree" }] }),
        active: () => "active",
      })

      expect(state.agent("worktree")).toBe(false)
      expect(state.agent("worktree", true)).toBe(true)
      expect(state.project("active", "worktree", true)).toBe(true)
      expect(state.project("other", "worktree")).toBe(false)
      expect(state.project("other", "worktree", true)).toBe(true)
    },
  )
})
