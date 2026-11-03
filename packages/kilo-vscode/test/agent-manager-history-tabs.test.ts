import { describe, expect, it } from "bun:test"
import { historyTabTarget, type HistorySource } from "../webview-ui/agent-manager/history-tabs"

const both: HistorySource[] = ["local", "worktree"]
const local: HistorySource[] = ["local"]

describe("historyTabTarget", () => {
  it("moves between the source tabs with wrapping arrows", () => {
    expect(historyTabTarget(both, "local", "ArrowRight")).toBe("worktree")
    expect(historyTabTarget(both, "worktree", "ArrowRight")).toBe("local")
    expect(historyTabTarget(both, "local", "ArrowLeft")).toBe("worktree")
    expect(historyTabTarget(both, "worktree", "ArrowLeft")).toBe("local")
  })

  it("jumps to the first and last tab", () => {
    expect(historyTabTarget(both, "worktree", "Home")).toBe("local")
    expect(historyTabTarget(both, "local", "End")).toBe("worktree")
  })

  it("ignores keys that do not move tabs", () => {
    expect(historyTabTarget(both, "local", "Enter")).toBeUndefined()
    expect(historyTabTarget(both, "local", "Tab")).toBeUndefined()
  })

  it("has nowhere to move when there is one source", () => {
    expect(historyTabTarget(local, "local", "ArrowRight")).toBe("local")
    expect(historyTabTarget([], "local", "Home")).toBeUndefined()
  })
})