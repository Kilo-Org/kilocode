import { describe, expect, it } from "bun:test"
import {
  rootSessions,
  worktreeSessionIds,
  worktreeSessions,
} from "../../webview-ui/agent-manager/project/session-filter"
import type { ProjectSessionInfo } from "../../webview-ui/src/types/messages"

const session = (id: string, worktreeId: string | null, parentID: string | null): ProjectSessionInfo => ({
  id,
  worktreeId,
  parentID,
  title: id,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
})

describe("rootSessions", () => {
  it("ignores child sessions when selecting a worktree label", () => {
    const sessions = [session("child", "wt-1", "root"), session("root", "wt-1", null), session("other", "wt-2", null)]

    expect(rootSessions(sessions, "wt-1").map((item) => item.id)).toEqual(["root"])
  })

  it("filters subagents from the local session list too", () => {
    const sessions = [session("child", null, "root"), session("root", null, null)]

    expect(rootSessions(sessions, null).map((item) => item.id)).toEqual(["root"])
  })

  it("preserves managed membership, chronological fallback, and custom tab order", () => {
    const rows = [
      { ...session("new", "wt-1", null), createdAt: "2026-01-02T00:00:00.000Z" },
      session("old", "wt-1", null),
      session("child", "wt-1", "old"),
      session("other", "wt-2", null),
    ]
    const managed = rows.map((item) => ({ id: item.id, worktreeId: item.worktreeId, createdAt: item.createdAt }))
    expect([...worktreeSessionIds("wt-1", managed)]).toEqual(["new", "old", "child"])
    expect(worktreeSessions("wt-1", managed, rows, undefined).map((item) => item.id)).toEqual(["old", "new"])
    expect(worktreeSessions("wt-1", managed, rows, ["missing", "new"]).map((item) => item.id)).toEqual(["new", "old"])
    expect(rows.map((item) => item.id)).toEqual(["new", "old", "child", "other"])
    expect(worktreeSessions("missing", managed, rows, undefined)).toEqual([])
  })
})
