import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { createDiffReviewScope } from "../../webview-ui/agent-manager/diff-review-scope"
import { routeReview } from "../../webview-ui/agent-manager/project/review-routing"
import { applyProjectSelection } from "../../webview-ui/agent-manager/project/selection"
import type { ExtensionMessage } from "../../webview-ui/src/types/messages"

const messages = {
  diff: { type: "agentManager.worktreeDiff", sessionId: "shared#branch", diffs: [] },
  file: { type: "agentManager.worktreeDiffFile", sessionId: "shared#branch", file: "file.ts", diff: null },
  loading: { type: "agentManager.worktreeDiffLoading", sessionId: "shared#branch", loading: true },
  notice: { type: "agentManager.worktreeDiffNotice", sessionId: "shared#branch", notice: "deleted" },
  branches: {
    type: "agentManager.diffBranches",
    sessionId: "shared#branch",
    branches: [],
    defaultBranch: "main",
    isAuto: true,
  },
  apply: { type: "agentManager.applyWorktreeDiffResult", worktreeId: "shared", status: "success", message: "Applied" },
  revert: {
    type: "agentManager.revertWorktreeFileResult",
    sessionId: "shared#branch",
    file: "file.ts",
    status: "success",
    message: "Reverted",
  },
} satisfies Record<string, ExtensionMessage>

function recorder() {
  const calls: { route: string; msg: ExtensionMessage }[] = []
  const record = (route: string) => (msg: ExtensionMessage) => calls.push({ route, msg })
  return {
    calls,
    handlers: {
      diff: record("diff"),
      file: record("file"),
      loading: record("loading"),
      notice: record("notice"),
      branches: record("branches"),
      apply: record("apply"),
      revert: record("revert"),
    },
  }
}

describe("project review routing", () => {
  it.each(Object.entries(messages))("routes %s by applied state throughout a project switch", (route, msg) => {
    const result = recorder()
    const active = "b"
    let applied: string | undefined
    const current = () => applied
    const previous = { ...msg, projectId: "a" }
    const next = { ...msg, projectId: active }

    expect(routeReview(next, current, result.handlers)).toBe("stale")
    applied = "a"
    expect(routeReview(next, current, result.handlers)).toBe("stale")
    expect(result.calls).toEqual([])
    expect(routeReview(previous, current, result.handlers)).toBe("handled")
    expect(result.calls).toEqual([{ route, msg: previous }])
    expect(result.calls.at(0)?.msg).toBe(previous)

    applied = active
    expect(routeReview(next, current, result.handlers)).toBe("handled")
    expect(routeReview(previous, current, result.handlers)).toBe("stale")
    expect(result.calls).toEqual([
      { route, msg: previous },
      { route, msg: next },
    ])
    expect(result.calls.at(1)?.msg).toBe(next)
  })

  it.each([undefined, "a"])("keeps legacy unqualified messages with applied project %j", (project) => {
    for (const [route, msg] of Object.entries(messages)) {
      const result = recorder()
      const empty = { ...msg, projectId: "" }
      expect(routeReview(msg, () => project, result.handlers)).toBe("handled")
      expect(routeReview(empty, () => project, result.handlers)).toBe("handled")
      expect(result.calls).toEqual([
        { route, msg },
        { route, msg: empty },
      ])
    }
  })

  it("leaves unrelated messages for the existing selection and project handlers", () => {
    const result = recorder()
    const selection: ExtensionMessage = {
      type: "agentManager.selectionActivated",
      target: { projectId: "b", kind: "worktree", worktreeId: "shared" },
    }
    const current = () => {
      throw new Error("Unrelated messages must not read the current project")
    }
    const events: ExtensionMessage[] = [
      selection,
      { type: "agentManager.prError", projectId: "a", error: "gh_missing" },
      { type: "agentManager.worktreeStats", projectId: "a", stats: [] },
      { type: "agentManager.keybindings", bindings: {} },
    ]
    for (const msg of events) expect(routeReview(msg, current, result.handlers)).toBe("unhandled")
    expect(result.calls).toEqual([])

    const calls: string[] = []
    expect(
      applyProjectSelection(selection, {
        active: (id) => id === "b",
        applied: (id) => id === "b",
        managed: () => [],
        local: (id) => calls.push(`local:${id}`),
        worktree: (id, worktree) => calls.push(`${id}:${worktree}`),
        focusLocal: (id) => calls.push(`session:${id}`),
        managedSession: (worktree, id) => calls.push(`${worktree}:${id}`),
      }),
    ).toBe(true)
    expect(calls).toEqual(["b:shared"])
  })

  it("keeps review content for identical worktree IDs isolated and preserves context filtering", () => {
    createRoot((dispose) => {
      let applied = "a"
      const current = () => applied
      const sent: unknown[] = []
      const review = createDiffReviewScope({
        ctx: () => "shared",
        session: () => undefined,
        panelOpen: () => false,
        reviewActive: () => false,
        vscode: { postMessage: (msg) => sent.push(msg) },
        project: current,
      })
      const handlers = { ...recorder().handlers, branches: review.onBranches }
      const previous = { ...messages.branches, projectId: "a", currentBranch: "branch-a" }
      const next = { ...messages.branches, projectId: "b", currentBranch: "branch-b" }

      expect(routeReview(previous, current, handlers)).toBe("handled")
      expect(review.currentBranch()).toBe("branch-a")
      expect(routeReview(next, current, handlers)).toBe("stale")
      expect(review.currentBranch()).toBe("branch-a")
      applied = "b"
      expect(routeReview(next, current, handlers)).toBe("handled")
      expect(routeReview(previous, current, handlers)).toBe("stale")
      expect(routeReview({ ...next, sessionId: "other#branch", currentBranch: "other" }, current, handlers)).toBe(
        "handled",
      )
      expect(review.currentBranch()).toBe("branch-b")
      expect(sent).toEqual([])
      dispose()
    })
  })
})
