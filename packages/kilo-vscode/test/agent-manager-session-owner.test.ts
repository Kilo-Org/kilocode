import { describe, expect, it } from "bun:test"
import { sessionOwner } from "../webview-ui/agent-manager/navigate"

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
