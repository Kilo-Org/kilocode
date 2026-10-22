import { describe, expect, it } from "bun:test"
import { rememberTarget, restoreProjectTarget, type RestoreDeps } from "../../webview-ui/agent-manager/project/restore"
import type { AgentManagerStateMessage } from "../../webview-ui/src/types/messages"

function state(over: Partial<AgentManagerStateMessage>): AgentManagerStateMessage {
  return {
    type: "agentManager.state",
    projectId: "prj-a",
    worktrees: [],
    sessions: [],
    ...over,
  }
}

function deps() {
  const calls: Record<string, unknown[]> = {}
  const record =
    (key: string) =>
    (...args: unknown[]) => {
      calls[key] = [...(calls[key] ?? []), ...(args.length > 0 ? args : [true])]
    }
  const impl: RestoreDeps = {
    selectLocal: () => record("local")(),
    selectWorktree: (id) => record("worktree")(id),
    focusLocal: (id) => record("focusLocal")(id),
    focusManaged: (wt, sid) => record("managed")(wt, sid),
    setSelection: (id) => record("selection")(id),
    setActivePendingId: (id) => record("pending")(id),
  }
  return { calls, impl }
}

describe("restoreProjectTarget", () => {
  it("restores a persisted worktree target", () => {
    const { calls, impl } = deps()
    restoreProjectTarget(
      state({
        worktrees: [{ id: "0" } as never],
        activeTarget: { projectId: "prj-a", kind: "worktree", worktreeId: "0" },
      }),
      impl,
    )
    expect(calls.worktree).toEqual(["0"])
    expect(calls.pending).toEqual([undefined])
  })

  it("restores a managed worktree session target", () => {
    const { calls, impl } = deps()
    restoreProjectTarget(
      state({
        worktrees: [{ id: "0" } as never],
        sessions: [{ id: "ses-1", worktreeId: "0" } as never],
        activeTarget: { projectId: "prj-a", kind: "session", sessionId: "ses-1" },
      }),
      impl,
    )
    expect(calls.managed).toEqual(["0", "ses-1"])
  })

  it("restores a local session target through the local focus path", () => {
    const { calls, impl } = deps()
    restoreProjectTarget(state({ activeTarget: { projectId: "prj-a", kind: "session", sessionId: "ses-x" } }), impl)
    expect(calls.focusLocal).toEqual(["ses-x"])
  })

  it("falls back to Local when the target no longer exists", () => {
    const { calls, impl } = deps()
    restoreProjectTarget(state({ activeTarget: { projectId: "prj-a", kind: "worktree", worktreeId: "gone" } }), impl)
    expect(calls.local).toHaveLength(1)
    expect(calls.worktree).toBeUndefined()
  })

  it("falls back to Local when there is no target", () => {
    const { calls, impl } = deps()
    restoreProjectTarget(state({}), impl)
    expect(calls.local).toHaveLength(1)
  })
})

describe("rememberTarget", () => {
  it("posts a session target when a session is active", () => {
    const posted: unknown[] = []
    rememberTarget((msg) => posted.push(msg), "prj-a", "0", "ses-1")
    expect(posted).toEqual([
      {
        type: "agentManager.rememberTarget",
        projectId: "prj-a",
        target: { projectId: "prj-a", kind: "session", sessionId: "ses-1" },
      },
    ])
  })

  it("posts a worktree target when no session is active", () => {
    const posted: unknown[] = []
    rememberTarget((msg) => posted.push(msg), "prj-a", "0", undefined)
    expect(posted).toEqual([
      {
        type: "agentManager.rememberTarget",
        projectId: "prj-a",
        target: { projectId: "prj-a", kind: "worktree", worktreeId: "0" },
      },
    ])
  })

  it("posts a local target for the Local context", () => {
    const posted: unknown[] = []
    rememberTarget((msg) => posted.push(msg), "prj-a", "local", undefined)
    expect(posted).toEqual([
      { type: "agentManager.rememberTarget", projectId: "prj-a", target: { projectId: "prj-a", kind: "local" } },
    ])
  })
})
