import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createProjectSessionsLive } from "../../webview-ui/agent-manager/project/sessions-live"
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
  it("uses managed placement while the project session cache is stale", () => {
    createRoot((dispose) => {
      const [base] = createSignal<Record<string, ProjectSessionInfo[]>>({ project: [session(null)] })
      const [store] = createSignal<SessionInfo[]>([session(null)])
      const live = createProjectSessionsLive({
        base,
        pid: () => "project",
        enabled: () => true,
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

  it("returns only the active project and keeps the legacy source when disabled", () => {
    createRoot((dispose) => {
      const state = { pid: "second" as string | undefined, enabled: true, store: [] as SessionInfo[] }
      const first = { ...session("same"), title: "First project" }
      const second = { ...session("same"), title: "Second project" }
      const live = createProjectSessionsLive({
        base: () => ({ first: [first], second: [second] }),
        pid: () => state.pid,
        enabled: () => state.enabled,
        store: () => state.store,
        managed: () => [],
        locals: () => new Set(),
      })
      expect(live.current()).toEqual([second])
      state.pid = "first"
      expect(live.current()).toEqual([first])
      state.pid = undefined
      expect(live.current()).toEqual([])
      state.enabled = false
      state.store = [first]
      expect(live.current()).toEqual([first])
      dispose()
    })
  })
})
