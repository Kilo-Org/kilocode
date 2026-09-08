import { describe, expect, test } from "bun:test"
import { handleSessionLifecycle } from "../../src/agent-manager/session-lifecycle"
import type { ProjectContexts } from "../../src/agent-manager/project/contexts"
import type { AgentManagerOutMessage } from "../../src/agent-manager/types"
import type { Session } from "@kilocode/sdk/v2/client"

const info: Session = {
  id: "session",
  slug: "test-session",
  projectID: "project",
  directory: "/repo",
  title: "Browser session",
  version: "1",
  time: { created: 1, updated: 2 },
}

describe("session lifecycle merge integration", () => {
  test.each(["sessionID", "info"])("preserves deletion guards and browser cleanup for %s events", (shape) => {
    const sessions: Array<{ id: string }> = []
    const closed: string[] = []
    const posted: AgentManagerOutMessage[] = []
    const context = {
      id: "project",
      lifecycle: "ready",
      peekState: () => undefined,
      sessions: () => sessions,
      upsertSession: (session: { id: string }) => sessions.push(session),
      removeLiveSession: (id: string) =>
        sessions.splice(
          sessions.findIndex((session) => session.id === id),
          1,
        ),
      invalidateSessions: () => {},
    }
    const deps = {
      busy: new Set([info.id]),
      removed: new Set<string>(),
      contexts: {
        byDirectory: () => context,
        byLiveSession: () => context,
      } as unknown as ProjectContexts,
      closeBrowser: (id: string) => closed.push(id),
      post: (message: AgentManagerOutMessage) => posted.push(message),
    }
    handleSessionLifecycle({ type: "session.created", properties: { info } }, deps)
    expect(sessions).toHaveLength(1)
    handleSessionLifecycle(
      { type: "session.deleted", properties: shape === "info" ? { info } : { sessionID: info.id } },
      deps,
    )
    expect(closed).toEqual([info.id])
    expect(deps.removed.has(info.id)).toBe(true)
    expect(deps.busy.has(info.id)).toBe(false)
    expect(sessions).toHaveLength(0)
    const count = posted.length
    handleSessionLifecycle({ type: "session.updated", properties: { info } }, deps)
    expect(sessions).toHaveLength(0)
    expect(posted).toHaveLength(count)
    handleSessionLifecycle({ type: "session.created", properties: { info } }, deps)
    expect(deps.removed.has(info.id)).toBe(false)
    expect(sessions).toHaveLength(1)
  })
})
