import { describe, expect, it } from "bun:test"
import { rootSessions } from "../../webview-ui/agent-manager/project/session-filter"
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
})
