import { describe, expect, it } from "bun:test"
import { newTabForSelection } from "../webview-ui/agent-manager/app-tabs"
import { LOCAL } from "../webview-ui/agent-manager/navigate"

function run(selection: string | null) {
  const calls: string[] = []
  const result = newTabForSelection({
    selection,
    addPending: () => {
      calls.push("pending")
      return "pending:1"
    },
    postToWorktree: (worktreeId) => calls.push(`post:${worktreeId}`),
    clearTerminal: () => calls.push("clear"),
  })
  return { result, calls }
}

describe("Agent Manager new tab", () => {
  it("leaves an active terminal tab before asking for a worktree session", () => {
    expect(run("wt-1")).toEqual({ result: "pending", calls: ["clear", "post:wt-1"] })
  })

  it("adds a Local draft, which leaves the terminal itself", () => {
    expect(run(LOCAL)).toEqual({ result: "ready", calls: ["pending"] })
  })

  it("does nothing without a selection", () => {
    expect(run(null)).toEqual({ result: "pending", calls: [] })
  })
})
