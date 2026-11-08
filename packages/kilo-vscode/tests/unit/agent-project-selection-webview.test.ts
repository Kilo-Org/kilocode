import { describe, expect, it } from "bun:test"
import { applyProjectSelection } from "../../webview-ui/agent-manager/project/selection"
import { agentProject, isStaleAgentSession } from "../../webview-ui/src/context/session-project"
import { mergeSessionsLoaded } from "../../webview-ui/src/context/session-paging"
import type { SessionInfo, SessionsLoadedMessage } from "../../webview-ui/src/types/messages"

function deps(active: string, applied = active) {
  const calls: string[] = []
  return {
    calls,
    value: {
      active: (projectId: string) => projectId === active,
      applied: (projectId: string) => projectId === applied,
      managed: () => [],
      local: (projectId: string) => calls.push(`local:${projectId}`),
      worktree: (projectId: string, worktreeId: string) => calls.push(`worktree:${projectId}:${worktreeId}`),
      focusLocal: (sessionId: string) => calls.push(`focusLocal:${sessionId}`),
      managedSession: (worktreeId: string, sessionId: string) => calls.push(`managed:${worktreeId}:${sessionId}`),
    },
  }
}

describe("applyProjectSelection", () => {
  it("ignores delayed local and worktree acknowledgements from another project", () => {
    const result = deps("prj-b")

    expect(
      applyProjectSelection(
        { type: "agentManager.selectionActivated", target: { projectId: "prj-a", kind: "local" } } as never,
        result.value,
      ),
    ).toBe(true)
    expect(
      applyProjectSelection(
        {
          type: "agentManager.selectionActivated",
          target: { projectId: "prj-a", kind: "worktree", worktreeId: "wt-a" },
        } as never,
        result.value,
      ),
    ).toBe(true)

    expect(result.calls).toEqual([])
  })

  it("applies acknowledgements for the catalog-active project", () => {
    const result = deps("prj-a")
    applyProjectSelection(
      { type: "agentManager.selectionActivated", target: { projectId: "prj-a", kind: "local" } } as never,
      result.value,
    )
    applyProjectSelection(
      {
        type: "agentManager.selectionActivated",
        target: { projectId: "prj-a", kind: "worktree", worktreeId: "wt-a" },
      } as never,
      result.value,
    )

    expect(result.calls).toEqual(["local:prj-a", "worktree:prj-a:wt-a"])
  })

  it("waits for the project state before applying an acknowledgement", () => {
    // Cold reactivation can acknowledge before the state push. Applying the
    // worktree then would read the previous project's store and clear the
    // current transcript. The state restore applies the target afterward.
    const result = deps("prj-a", "prj-b")
    applyProjectSelection(
      {
        type: "agentManager.selectionActivated",
        target: { projectId: "prj-a", kind: "worktree", worktreeId: "wt-a" },
      } as never,
      result.value,
    )

    expect(result.calls).toEqual([])
  })
})

describe("project-scoped session refresh", () => {
  it("keeps the selected local session when the previous project's list arrives after a switch", () => {
    const local: SessionInfo = { id: "ses-b", parentID: null, createdAt: "", updatedAt: "" }
    const sessions: Record<string, SessionInfo> = { [local.id]: local }
    const project = agentProject({
      type: "agentManager.projects",
      projects: [{ id: "prj-b", active: true }],
    } as never)
    const apply = (message: SessionsLoadedMessage) => {
      if (isStaleAgentSession(message, project)) return
      mergeSessionsLoaded({ loaded: message.sessions, fresh: new Set(), setSessions: (update) => update(sessions) })
    }

    apply({ type: "sessionsLoaded", projectId: "prj-a", sessions: [] })
    expect(sessions[local.id]).toBe(local)
    apply({ type: "sessionsLoaded", projectId: "prj-b", sessions: [local] })
    expect(Object.keys(sessions)).toEqual([local.id])
  })

  it("rejects old-project pages and accepts current-project or ordinary sidebar lists", () => {
    const page: SessionsLoadedMessage = { type: "sessionsLoaded", projectId: "prj-a", sessions: [], append: true }
    expect(isStaleAgentSession(page, "prj-b")).toBe(true)
    expect(isStaleAgentSession(page, "prj-a")).toBe(false)
    expect(isStaleAgentSession(page, undefined)).toBe(false)
    expect(isStaleAgentSession({ type: "sessionsLoaded", sessions: [] }, "prj-b")).toBe(false)
  })
})
