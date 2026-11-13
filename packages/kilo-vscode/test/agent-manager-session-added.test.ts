import { describe, expect, it } from "bun:test"
import { applySessionAdded } from "../webview-ui/agent-manager/app-messages"

const record = () => {
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
})
