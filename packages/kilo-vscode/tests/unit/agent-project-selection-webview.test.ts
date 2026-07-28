import { describe, expect, it } from "bun:test"
import { applyProjectSelection } from "../../webview-ui/agent-manager/project/selection"

function deps(active: string) {
  const calls: string[] = []
  return {
    calls,
    value: {
      active: (projectId: string) => projectId === active,
      managed: () => [],
      local: (projectId: string) => calls.push(`local:${projectId}`),
      worktree: (projectId: string, worktreeId: string) => calls.push(`worktree:${projectId}:${worktreeId}`),
      session: (sessionId: string) => calls.push(`session:${sessionId}`),
      openTab: (sessionId: string) => calls.push(`openTab:${sessionId}`),
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

  it("applies a worktree ack optimistically even before the state push arrives", () => {
    // Regression: reactivation pushes state asynchronously, so the ack can
    // arrive first. The catalog push is synchronous, so the project is already
    // active and the ack must not be dropped.
    const result = deps("prj-a")
    applyProjectSelection(
      {
        type: "agentManager.selectionActivated",
        target: { projectId: "prj-a", kind: "worktree", worktreeId: "wt-a" },
      } as never,
      result.value,
    )

    expect(result.calls).toEqual(["worktree:prj-a:wt-a"])
  })
})
