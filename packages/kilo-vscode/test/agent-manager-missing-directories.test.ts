import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createAppDirectories } from "../webview-ui/agent-manager/app-directories"
import { createProjectStore } from "../webview-ui/agent-manager/project/store"
import type { AgentManagerStateMessage, WorktreeState } from "../webview-ui/src/types/messages/agent-manager"

function tree(id: string): WorktreeState {
  return {
    id,
    branch: id,
    path: `/repo/.kilo/worktrees/${id}`,
    parentBranch: "main",
    createdAt: "2026-08-01T00:00:00.000Z",
  }
}

function state(health: AgentManagerStateMessage["worktreeHealth"], stale: string[] = []): AgentManagerStateMessage {
  return {
    type: "agentManager.state",
    worktrees: [tree("ok"), tree("restorable"), tree("gone"), tree("probed")],
    sessions: [],
    worktreeHealth: health,
    staleWorktreeIds: stale,
  } as AgentManagerStateMessage
}

describe("missingDirectories", () => {
  it("lists the worktree folders the host found deleted on disk, and drops a restored one", () => {
    createRoot((dispose) => {
      const store = createProjectStore("prj")
      const directories = createAppDirectories({
        projects: () => [{ id: "prj", root: "/repo" } as never],
        activeProjectId: () => "prj",
        store: () => store,
        currentProjectId: () => "prj",
        selection: () => null,
        managedSessions: () => [],
        openTabs: () => [],
      })
      store.applyState(
        state({ restorable: "absent-restorable", gone: "absent-gone", ok: "unavailable" }, ["probed"]),
      )
      expect(directories.missingDirectories()).toEqual([
        "/repo/.kilo/worktrees/restorable",
        "/repo/.kilo/worktrees/gone",
        "/repo/.kilo/worktrees/probed",
      ])

      store.applyState(state({ gone: "absent-gone" }))
      expect(directories.missingDirectories()).toEqual(["/repo/.kilo/worktrees/gone"])
      dispose()
    })
  })
})
