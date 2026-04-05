import { describe, it, expect } from "bun:test"
import { nextSelectionAfterDelete, LOCAL } from "../../webview-ui/agent-manager/navigate"

describe("nextSelectionAfterDelete", () => {
  it("selects the worktree below when deleting from the middle", () => {
    expect(nextSelectionAfterDelete("b", ["a", "b", "c"])).toBe("c")
  })

  it("selects the worktree above when deleting the last item", () => {
    expect(nextSelectionAfterDelete("c", ["a", "b", "c"])).toBe("b")
  })

  it("selects the worktree below when deleting the first item", () => {
    expect(nextSelectionAfterDelete("a", ["a", "b", "c"])).toBe("b")
  })

  it("falls back to LOCAL when deleting the only worktree", () => {
    expect(nextSelectionAfterDelete("a", ["a"])).toBe(LOCAL)
  })

  it("falls back to LOCAL when ID is not found", () => {
    expect(nextSelectionAfterDelete("x", ["a", "b"])).toBe(LOCAL)
  })

  it("falls back to LOCAL when list is empty", () => {
    expect(nextSelectionAfterDelete("a", [])).toBe(LOCAL)
  })

  it("handles two-item list deleting first", () => {
    expect(nextSelectionAfterDelete("a", ["a", "b"])).toBe("b")
  })

  it("handles two-item list deleting second", () => {
    expect(nextSelectionAfterDelete("b", ["a", "b"])).toBe("a")
  })
})
