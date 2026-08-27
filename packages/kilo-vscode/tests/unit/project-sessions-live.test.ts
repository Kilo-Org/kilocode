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
      dispose()
    })
  })
})
