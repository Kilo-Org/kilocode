import { describe, expect, it } from "bun:test"
import { applySessionAdded } from "../webview-ui/agent-manager/app-messages"

const record = (quiet = new Set<string>()) => {
  const calls: string[] = []
  return {
    calls,
    deps: {
      currentProjectId: () => "project",
      saveTabMemory: () => calls.push("save"),
      appendOrder: (worktreeId: string, sessionId: string) => calls.push(`order:${worktreeId}:${sessionId}`),
      setSelection: (id: string) => calls.push(`select:${id}`),
      evictLocal: (id: string) => calls.push(`evict:${id}`),
      focusLocal: (id: string) => calls.push(`local:${id}`),
      applyDraft: (worktreeId: string, sessionId: string) => calls.push(`draft:${worktreeId}:${sessionId}`),
      selectSession: (id: string) => calls.push(`session:${id}`),
      requestChatFocus: () => calls.push("focus"),
      clearTerminal: () => calls.push("terminal:off"),
      quiet: (id: string) => quiet.delete(id),
      placeLocal: (id: string) => calls.push(`place:${id}`),
    },
  }
}

describe("applySessionAdded", () => {
  it("adds a worktree session to that worktree's tabs", () => {
    const test = record()

    applySessionAdded({ type: "agentManager.sessionAdded", sessionId: "s", worktreeId: "wt-1" }, test.deps)

    expect(test.calls).toContain("order:wt-1:s")
    expect(test.calls).toContain("select:wt-1")
    expect(test.calls).toContain("evict:s")
    expect(test.calls).not.toContain("local:s")
  })

  it("shows the new session over a main terminal tab of the same worktree", () => {
    const test = record()

    applySessionAdded({ type: "agentManager.sessionAdded", sessionId: "s", worktreeId: "wt-1" }, test.deps)

    // Cmd+T from a focused terminal tab: the terminal leaves the main pane before the session is selected.
    expect(test.calls.indexOf("terminal:off")).toBeGreaterThan(-1)
    expect(test.calls.indexOf("terminal:off")).toBeLessThan(test.calls.indexOf("session:s"))
    expect(test.calls.indexOf("save")).toBeLessThan(test.calls.indexOf("terminal:off"))
  })

  it("places a session the host files under Local in the local tabs", () => {
    const test = record()

    applySessionAdded({ type: "agentManager.sessionAdded", sessionId: "s", worktreeId: "local" }, test.deps)

    expect(test.calls).toContain("local:s")
    expect(test.calls).not.toContain("select:local")
    expect(test.calls).not.toContain("evict:s")
    expect(test.calls).not.toContain("order:local:s")
  })

  it("ignores a session of another project", () => {
    const test = record()

    applySessionAdded(
      { type: "agentManager.sessionAdded", projectId: "other", sessionId: "s", worktreeId: "wt-1" },
      test.deps,
    )

    expect(test.calls).toEqual([])
  })

  it("files a session the panel added in the background without taking the view", () => {
    const test = record(new Set(["s"]))

    applySessionAdded({ type: "agentManager.sessionAdded", sessionId: "s", worktreeId: "wt-1" }, test.deps)

    expect(test.calls).toEqual(["order:wt-1:s", "evict:s"])
  })

  it("places a background session the host files under Local without focusing it", () => {
    const test = record(new Set(["s"]))

    applySessionAdded({ type: "agentManager.sessionAdded", sessionId: "s", worktreeId: "local" }, test.deps)

    expect(test.calls).toEqual(["place:s"])
  })
})
