import { describe, it, expect } from "bun:test"
import { nextSelectionAfterDelete, LOCAL } from "../../webview-ui/agent-manager/navigate"
import { buildSidebarOrder, buildTopLevelItems } from "../../webview-ui/agent-manager/section-helpers"

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

  it("skips an empty neighbor to select a worktree with a session", () => {
    expect(nextSelectionAfterDelete("a", ["a", "empty", "c"], (id) => id === "c")).toBe("c")
  })

  it("selects the nearest available worktree above instead of a farther one below", () => {
    expect(nextSelectionAfterDelete("b", ["a", "b", "empty", "d"], (id) => id !== "empty")).toBe("a")
  })

  it("prefers the worktree below when available neighbors are equally distant", () => {
    expect(nextSelectionAfterDelete("c", ["a", "empty-b", "c", "empty-d", "e"], (id) => !id.startsWith("empty"))).toBe(
      "e",
    )
  })

  it("does not wrap to the last worktree when skipping unavailable neighbors", () => {
    expect(nextSelectionAfterDelete("a", ["a", "empty", "c", "d"], (id) => id !== "empty")).toBe("c")
  })

  it("falls back to LOCAL when no remaining worktree is available", () => {
    expect(nextSelectionAfterDelete("a", ["a", "empty", "deleting", "stale"], (id) => id === "a")).toBe(LOCAL)
  })

  it.each([
    { deleted: "above", collapsed: ["hidden"], expected: "below" },
    { deleted: "below", collapsed: ["hidden"], expected: "above" },
    { deleted: "above", collapsed: ["hidden", "after"], expected: LOCAL },
    { deleted: "hidden-a", collapsed: ["hidden"], expected: "below" },
    { deleted: "hidden-a", collapsed: ["before", "hidden", "after"], expected: LOCAL },
  ])("selects $expected after deleting $deleted with collapsed sections $collapsed", (test) => {
    const sections = ["before", "hidden", "after"].map((id, order) => ({
      id,
      name: id,
      color: null,
      order,
      collapsed: test.collapsed.includes(id),
    }))
    const worktrees = [
      { id: "above", sectionId: "before" },
      { id: "hidden-a", sectionId: "hidden" },
      { id: "hidden-b", sectionId: "hidden" },
      { id: "below", sectionId: "after" },
    ].map((item) => ({
      ...item,
      branch: item.id,
      path: `/tmp/${item.id}`,
      parentBranch: "main",
      createdAt: "2024-01-01",
    }))
    const items = buildTopLevelItems(sections, [], worktrees, [])
    const order = buildSidebarOrder(
      items,
      worktrees,
      sections,
      (id) => worktrees.filter((wt) => wt.sectionId === id),
      test.deleted,
    )
      .filter((item) => item.type === "wt")
      .map((item) => item.id)
    expect(nextSelectionAfterDelete(test.deleted, order)).toBe(test.expected)
  })
})
