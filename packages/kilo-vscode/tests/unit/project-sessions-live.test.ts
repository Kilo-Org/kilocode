import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createProjectSessionsLive } from "../../webview-ui/agent-manager/project/sessions-live"
import { recentSessions } from "../../webview-ui/src/context/session-utils"
import { fixture } from "../fixtures/run"
import type { ProjectSessionInfo, SessionInfo } from "../../webview-ui/src/types/messages"

const session = (worktreeId: string | null): ProjectSessionInfo => ({
  id: "session-1",
  parentID: null,
  title: "Restore worktree metadata",
  createdAt: "2026-08-26T10:00:00.000Z",
  updatedAt: "2026-08-26T10:00:00.000Z",
  worktreeId,
})

describe("project session live state", () => {
  it("keeps recent sessions scoped across project switches and empty projects", () => {
    createRoot((dispose) => {
      const first = [1, 2, 3, 4].map((day) => ({
        ...session(null),
        id: `first-${day}`,
        updatedAt: `2026-08-0${day}T10:00:00.000Z`,
      }))
      const second = [{ ...session(null), id: "second" }]
      const stale = { ...session(null), id: "unscoped", updatedAt: "2026-09-01T10:00:00.000Z" }
      const child = { ...session(null), id: "child", parentID: "second" }
      const store = [...first, ...second, stale, child]
      const state = { pid: "first" }
      const live = createProjectSessionsLive({
        base: () => ({ first, second, empty: [] }),
        pid: () => state.pid,
        store: () => store,
        managed: () => [],
        locals: () => new Set(),
      })
      const recent = () => recentSessions(live.current()).map((item) => item.id)

      expect(recent()).toEqual(["first-4", "first-3", "first-2"])
      state.pid = "second"
      expect(recent()).toEqual(["second"])
      state.pid = "empty"
      expect(recent()).toEqual([])
      expect(recentSessions(store).map((item) => item.id)).toEqual(["unscoped", "second", "first-4"])
      dispose()
    })
  })

  it(
    "consumes a project-scoped sessions accessor and keeps the shared store as the default",
    () => fixture("welcome-recent-sessions"),
    30_000,
  )

  it("uses managed placement while the project session cache is stale", () => {
    createRoot((dispose) => {
      const [base] = createSignal<Record<string, ProjectSessionInfo[]>>({ project: [session(null)] })
      const [store] = createSignal<SessionInfo[]>([session(null)])
      const live = createProjectSessionsLive({
        base,
        pid: () => "project",
        store,
        managed: () => [{ id: "session-1", worktreeId: "worktree-1", createdAt: "2026-08-26T10:00:00.000Z" }],
        locals: () => new Set(),
      })

      expect(live().project?.[0]).toMatchObject({
        id: "session-1",
        title: "Restore worktree metadata",
        worktreeId: "worktree-1",
      })
      expect(live.current()).toEqual(live().project!)
      dispose()
    })
  })

  it("returns only the active project and does not expose unscoped sessions", () => {
    createRoot((dispose) => {
      const state = { pid: "second" as string | undefined, store: [] as SessionInfo[] }
      const first = { ...session("same"), title: "First project" }
      const second = { ...session("same"), title: "Second project" }
      const live = createProjectSessionsLive({
        base: () => ({ first: [first], second: [second] }),
        pid: () => state.pid,
        store: () => state.store,
        managed: () => [],
        locals: () => new Set(),
      })
      expect(live.current()).toEqual([second])
      state.pid = "first"
      expect(live.current()).toEqual([first])
      state.pid = undefined
      expect(live.current()).toEqual([])
      state.store = [first]
      expect(live.current()).toEqual([])
      dispose()
    })
  })
})
