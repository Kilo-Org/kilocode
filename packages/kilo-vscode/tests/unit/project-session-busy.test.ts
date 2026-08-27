import { describe, expect, it } from "bun:test"
import { createSessionBusy, createWorktreeBusy } from "../../webview-ui/agent-manager/project/session-busy"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"

const options = (statuses: Record<string, { type: string }>) => ({
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
const busy = (statuses: Record<string, { type: string }>) => createSessionBusy(options(statuses))

describe("createSessionBusy", () => {
  it("does not mark stopped or unknown sessions as busy", () => {
    const state = busy({ idle: { type: "idle" } })

    expect(state.agent("wt-unknown")).toBe(false)
    expect(state.agent("wt-idle")).toBe(false)
    expect(state.project("background", "wt-unknown")).toBe(false)
  })

  it.each(["busy", "retry"])("marks sessions with an active %s status as busy", (type) => {
    expect(busy({ working: { type } }).agent("wt-working")).toBe(true)
  })

  it("keeps running for non-blocking questions", () => {
    const questions: { sessionID: string; blocking?: boolean }[] = [{ sessionID: "working", blocking: false }]
    const state = createSessionBusy({
      ...options({ working: { type: "busy" } }),
      questions: () => questions,
    })
    expect(state.agent("wt-working")).toBe(true)
    questions[0].blocking = true
    expect(state.agent("wt-working")).toBe(false)
    delete questions[0].blocking
    expect(state.agent("wt-working")).toBe(false)
  })

  it("does not keep a spinner for an offline session", () => {
    const state = busy({ working: { type: "offline" }, unknown: { type: "offline" } })

    expect(state.agent("wt-working")).toBe(false)
    expect(state.session("working")).toBe(false)
    expect(state.project("background", "wt-unknown")).toBe(false)
    expect(state.agent("wt-working", true)).toBe(true)
    expect(state.project("background", "wt-unknown", true)).toBe(true)
  })
})

describe("createWorktreeBusy", () => {
  it("keeps directory activity separate from parent status and other projects", () => {
    const listeners = new Set<(message: ExtensionMessage) => void>()
    const state = createWorktreeBusy({
      ...options({ idle: { type: "idle" }, working: { type: "busy" } }),
      worktrees: (project) => [
        { id: "wt-idle", path: project === "background" ? "/other/worktree" : "/repo/worktree" },
      ],
      subscribe: (callback) => {
        listeners.add(callback)
        return () => listeners.delete(callback)
      },
    })
    const send = (active: string[]) => {
      for (const callback of listeners) callback({ type: "agentManager.worktreeActivity", active })
    }

    expect(state.agent("wt-idle")).toBe(false)
    expect(state.agent("wt-working")).toBe(true)
    send(["/repo/worktree"])
    expect(state.agent("wt-idle")).toBe(true)
    expect(state.project("project-a", "wt-idle")).toBe(true)
    expect(state.project("background", "wt-idle")).toBe(false)
    expect(state.project("background", null)).toBe(false)
    expect(state.agent("missing")).toBe(false)
    expect(state.session("idle")).toBe(false)
    expect(state.local()).toBe(false)

    send(["/other/worktree"])
    expect(state.agent("wt-idle")).toBe(false)
    expect(state.project("background", "wt-idle")).toBe(true)
    send([])
    expect(state.project("background", "wt-idle")).toBe(false)
    expect(state.agent("wt-working")).toBe(true)
  })

  it.each(["permission", "question", "non-blocking question"] as const)(
    "blocks deletion for a pending %s without showing a running spinner",
    (kind) => {
      const state = createWorktreeBusy({
        statuses: () => ({ session: { type: "idle" } }),
        permissions: () => (kind === "permission" ? [{ sessionID: "session" }] : []),
        questions: () => (kind !== "permission" ? [{ sessionID: "session", blocking: kind === "question" }] : []),
        worktrees: () => [],
        subscribe: () => () => undefined,
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
