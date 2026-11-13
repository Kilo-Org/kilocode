import { describe, expect, it } from "bun:test"
import { sessionOwner, showsSession } from "../webview-ui/agent-manager/navigate"

const worktrees = [
  { id: "wt-a", path: "/repo/.kilo/worktrees/a" },
  { id: "wt-b", path: "/repo/.kilo/worktrees/b/" },
]

describe("sessionOwner", () => {
  it("resolves the worktree of the session's directory, not the selected one", () => {
    const sessions = [{ id: "s", location: { directory: "/repo/.kilo/worktrees/b" } }]
    expect(sessionOwner("s", sessions, worktrees)).toBe("wt-b")
  })

  it("reports a session that runs in the project root as outside every worktree", () => {
    const sessions = [{ id: "s", location: { directory: "/repo" } }]
    expect(sessionOwner("s", sessions, worktrees)).toBeNull()
  })

  it("reports an unloaded session as unknown", () => {
    expect(sessionOwner("s", [], worktrees)).toBeUndefined()
  })
})

describe("showsSession", () => {
  it("hides a session of Local or another worktree in the selected worktree", () => {
    expect(showsSession("wt-a", null)).toBe(false)
    expect(showsSession("wt-a", "wt-b")).toBe(false)
  })

  it("shows a session in the worktree that runs it", () => {
    expect(showsSession("wt-a", "wt-a")).toBe(true)
  })

  it("shows a session whose directory is not known yet, and every session in Local", () => {
    expect(showsSession("wt-a", undefined)).toBe(true)
    expect(showsSession("local", "wt-b")).toBe(true)
    expect(showsSession(null, null)).toBe(true)
  })
})
