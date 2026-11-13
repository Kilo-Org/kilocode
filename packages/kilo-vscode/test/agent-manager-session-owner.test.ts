import { describe, expect, it } from "bun:test"
import { sendFiling, sessionOwner, showsSession } from "../webview-ui/agent-manager/navigate"

const worktrees = [
  { id: "wt-a", path: "/repo/.kilo/worktrees/a" },
  { id: "wt-b", path: "/repo/.kilo/worktrees/b/" },
]

describe("sessionOwner", () => {
  it("resolves the worktree of the session's directory, not the selected one", () => {
    const sessions = [{ id: "s", location: { directory: "/repo/.kilo/worktrees/b" } }]
    expect(sessionOwner("s", sessions, worktrees, "/repo")).toBe("wt-b")
  })

  it("reports a session that runs in the project root as outside every worktree", () => {
    const sessions = [{ id: "s", location: { directory: "/repo" } }]
    expect(sessionOwner("s", sessions, worktrees, "/repo")).toBeNull()
  })

  it("reports an unloaded session as unknown", () => {
    expect(sessionOwner("s", [], worktrees, "/repo")).toBeUndefined()
  })

  it("reports a session in a directory it cannot place as unknown, so the host filing stays", () => {
    const sessions = [{ id: "s", location: { directory: "/private/repo/.kilo/worktrees/a" } }]
    expect(sessionOwner("s", sessions, worktrees, "/repo")).toBeUndefined()
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

describe("sendFiling", () => {
  it("keeps a session where it is filed in the selected context", () => {
    expect(sendFiling({ selection: "local", filed: null, local: true, owner: "wt-a" })).toBeNull()
    expect(sendFiling({ selection: "local", filed: undefined, local: true, owner: "wt-a" })).toBeNull()
    expect(sendFiling({ selection: "wt-a", filed: "wt-a", local: false, owner: "wt-a" })).toBe("wt-a")
  })

  it("files a new session where it runs when the selection changed during the send", () => {
    expect(sendFiling({ selection: "wt-a", filed: undefined, local: false, owner: null })).toBeNull()
    expect(sendFiling({ selection: "wt-a", filed: undefined, local: false, owner: "wt-b" })).toBe("wt-b")
    expect(sendFiling({ selection: "local", filed: undefined, local: false, owner: "wt-b" })).toBe("wt-b")
  })
})
