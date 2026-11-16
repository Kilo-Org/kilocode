import { describe, expect, it } from "bun:test"
import { restoreProjectTarget, type RestoreDeps } from "../webview-ui/agent-manager/project/restore"

const ROOT = "/repo"
const WORKTREE = "/repo/.kilo/worktrees/one"

function setup(input: {
  worktreeId: string | null
  directory?: string
  kind?: "session" | "worktree"
}) {
  const calls: string[] = []
  const deps: RestoreDeps = {
    selectLocal: () => calls.push("local"),
    selectWorktree: (id) => calls.push(`worktree:${id}`),
    focusLocal: (id) => calls.push(`focus-local:${id}`),
    focusManaged: (worktreeId, sessionId) => calls.push(`focus-managed:${worktreeId}:${sessionId}`),
    setSelection: (id) => calls.push(`selection:${id}`),
    setActivePendingId: () => {},
    directoryOf: () => input.directory,
  }
  const state = {
    projectId: "p1",
    worktrees: [{ id: "wt1", path: WORKTREE }],
    sessions: [{ id: "s1", worktreeId: input.worktreeId, createdAt: "" }],
    activeTarget:
      input.kind === "worktree"
        ? { projectId: "p1", kind: "worktree", worktreeId: "wt1" }
        : { projectId: "p1", kind: "session", sessionId: "s1" },
  } as never
  restoreProjectTarget(state, deps)
  return calls
}

describe("restoreProjectTarget", () => {
  it("lands on Local when the pinned worktree filing disagrees with the server directory", () => {
    expect(setup({ worktreeId: "wt1", directory: ROOT })).toEqual(["focus-local:s1"])
  })

  it("lands on the worktree that actually runs the session", () => {
    expect(setup({ worktreeId: null, directory: WORKTREE })).toEqual(["focus-managed:wt1:s1"])
    expect(setup({ worktreeId: null, directory: `${WORKTREE}/` })).toEqual(["focus-managed:wt1:s1"])
  })

  it("falls back to the filing until the catalog lists the session", () => {
    expect(setup({ worktreeId: "wt1" })).toEqual(["focus-managed:wt1:s1"])
    expect(setup({ worktreeId: null })).toEqual(["focus-local:s1"])
  })

  it("restores a worktree target directly", () => {
    expect(setup({ worktreeId: "wt1", kind: "worktree" })).toEqual(["worktree:wt1"])
  })
})
