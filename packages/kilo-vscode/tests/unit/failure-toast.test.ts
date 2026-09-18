import { describe, expect, it } from "bun:test"
import { reportFailure } from "../../webview-ui/agent-manager/failure-toast"

type Toast = { variant: string; title: string; description: string }

function host(project: string | undefined = "p1") {
  const toasts: Toast[] = []
  return { toasts, toast: (toast: Toast) => toasts.push(toast), t: (key: string) => key, project }
}

describe("reportFailure", () => {
  it("shows a PR error for the project on screen", () => {
    const h = host()

    expect(reportFailure({ type: "agentManager.prError", projectId: "p1", error: "merge_failed" }, h)).toBeUndefined()

    expect(h.toasts).toEqual([
      {
        variant: "error",
        title: "agentManager.pr.error.merge_failed.title",
        description: "agentManager.pr.error.merge_failed.description",
      },
    ])
  })

  it("answers stale for a PR error from another project and shows nothing", () => {
    // The caller stops routing on "stale": a background project's failure must not be applied to the
    // project on screen, which is the control flow the inline branch used to express with a return.
    const h = host("p1")

    expect(reportFailure({ type: "agentManager.prError", projectId: "p2", error: "merge_failed" }, h)).toBe("stale")

    expect(h.toasts).toEqual([])
  })

  it("shows a plain error message and keeps the caller routing", () => {
    const h = host()

    expect(reportFailure({ type: "error", message: "Could not restore the worktree" }, h)).toBeUndefined()

    expect(h.toasts).toEqual([
      { variant: "error", title: "agentManager.error.title", description: "Could not restore the worktree" },
    ])
  })

  it("ignores a message that reports no failure", () => {
    const h = host()

    // An error with nothing to say would be a toast with an empty body.
    expect(reportFailure({ type: "error", message: "" }, h)).toBeUndefined()
    expect(reportFailure({ type: "error" }, h)).toBeUndefined()
    expect(reportFailure({ type: "agentManager.state" }, h)).toBeUndefined()

    expect(h.toasts).toEqual([])
  })
})
