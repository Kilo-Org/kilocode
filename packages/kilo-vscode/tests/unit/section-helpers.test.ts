import { describe, it, expect } from "bun:test"
import {
  buildTopLevelItems,
  buildSidebarOrder,
  buildShortcutMap,
  isGrouped,
  isGroupStart,
  isGroupEnd,
} from "../../webview-ui/agent-manager/section-helpers"
import type { WorktreeState, SectionState } from "../../webview-ui/src/types/messages"

function wt(id: string, opts: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id,
    branch: `branch-${id}`,
    path: `/tmp/${id}`,
    parentBranch: "main",
    createdAt: "2024-01-01",
    ...opts,
  }
}

function sec(id: string, order: number, opts: Partial<SectionState> = {}): SectionState {
  return { id, name: `Section ${id}`, color: null, order, collapsed: false, ...opts }
}

describe("buildTopLevelItems", () => {
  it("returns flat worktree list when no sections", () => {
    const all = [wt("a"), wt("b"), wt("c")]
    const result = buildTopLevelItems([], [], all, [])
    expect(result).toHaveLength(3)
    expect(result.every((r) => r.kind === "worktree")).toBe(true)
  })

  it("interleaves sections and worktrees per order", () => {
    const s1 = sec("s1", 0)
    const w1 = wt("w1")
    const s2 = sec("s2", 1)
    const result = buildTopLevelItems([s1, s2], [w1], [w1], ["s1", "w1", "s2"])
    expect(result).toHaveLength(3)
    expect(result[0]).toEqual({ kind: "section", section: s1 })
    expect(result[1]).toEqual({ kind: "worktree", wt: w1 })
    expect(result[2]).toEqual({ kind: "section", section: s2 })
  })

  it("appends unordered sections and worktrees at the end", () => {
    const s1 = sec("s1", 0)
    const s2 = sec("s2", 1)
    const w1 = wt("w1")
    const w2 = wt("w2")
    // Only s1 is in the order array
    const result = buildTopLevelItems([s1, s2], [w1, w2], [w1, w2], ["s1", "w1"])
    expect(result).toHaveLength(4)
    expect(result[0]).toEqual({ kind: "section", section: s1 })
    expect(result[1]).toEqual({ kind: "worktree", wt: w1 })
    // unordered items appended
    expect(result[2]).toEqual({ kind: "section", section: s2 })
    expect(result[3]).toEqual({ kind: "worktree", wt: w2 })
  })

  it("skips duplicate ids in order array", () => {
    const s1 = sec("s1", 0)
    const w1 = wt("w1")
    const result = buildTopLevelItems([s1], [w1], [w1], ["s1", "w1", "s1", "w1"])
    expect(result).toHaveLength(2)
  })
})

describe("isGrouped", () => {
  it("returns true when groupId is set", () => {
    expect(isGrouped(wt("a", { groupId: "g1" }))).toBe(true)
  })

  it("returns false when groupId is undefined", () => {
    expect(isGrouped(wt("a"))).toBe(false)
  })

  it("returns false when groupId is empty string", () => {
    expect(isGrouped(wt("a", { groupId: "" }))).toBe(false)
  })
})

describe("isGroupStart", () => {
  const list = [wt("a", { groupId: "g1" }), wt("b", { groupId: "g1" }), wt("c", { groupId: "g2" }), wt("d")]

  it("returns true for first item in group", () => {
    expect(isGroupStart(list[0]!, 0, list)).toBe(true)
  })

  it("returns false for middle/end item in same group", () => {
    expect(isGroupStart(list[1]!, 1, list)).toBe(false)
  })

  it("returns true when previous item has different groupId", () => {
    expect(isGroupStart(list[2]!, 2, list)).toBe(true)
  })

  it("returns false for ungrouped worktree", () => {
    expect(isGroupStart(list[3]!, 3, list)).toBe(false)
  })
})

describe("isGroupEnd", () => {
  const list = [wt("a", { groupId: "g1" }), wt("b", { groupId: "g1" }), wt("c", { groupId: "g2" }), wt("d")]

  it("returns false for start/middle of group", () => {
    expect(isGroupEnd(list[0]!, 0, list)).toBe(false)
  })

  it("returns true for last item in group when next has different groupId", () => {
    expect(isGroupEnd(list[1]!, 1, list)).toBe(true)
  })

  it("returns true for last item in list with groupId", () => {
    expect(isGroupEnd(list[2]!, 2, list)).toBe(true)
  })

  it("returns false for ungrouped worktree", () => {
    expect(isGroupEnd(list[3]!, 3, list)).toBe(false)
  })
})

describe("buildSidebarOrder", () => {
  it("returns LOCAL + all sorted worktrees when no sections exist", () => {
    const sorted = [wt("a"), wt("b"), wt("c")]
    const items = buildTopLevelItems([], [], sorted, [])
    const result = buildSidebarOrder(items, sorted, [], () => [], [])
    expect(result).toEqual([
      { type: "local", id: "local" },
      { type: "wt", id: "a" },
      { type: "wt", id: "b" },
      { type: "wt", id: "c" },
    ])
  })

  it("includes section worktrees in visual order", () => {
    const s1 = sec("s1", 0)
    const w1 = wt("w1", { sectionId: "s1" })
    const w2 = wt("w2", { sectionId: "s1" })
    const w3 = wt("w3")
    const sorted = [w1, w2, w3]
    const items = buildTopLevelItems([s1], [w3], sorted, ["s1", "w3"])
    const members = (id: string) => (id === "s1" ? [w1, w2] : [])
    const result = buildSidebarOrder(items, sorted, [s1], members, [])
    expect(result).toEqual([
      { type: "local", id: "local" },
      { type: "wt", id: "w1" },
      { type: "wt", id: "w2" },
      { type: "wt", id: "w3" },
    ])
  })

  it("skips worktrees in collapsed sections", () => {
    const s1 = sec("s1", 0, { collapsed: true })
    const w1 = wt("w1", { sectionId: "s1" })
    const w2 = wt("w2")
    const sorted = [w1, w2]
    const items = buildTopLevelItems([s1], [w2], sorted, ["s1", "w2"])
    const members = (id: string) => (id === "s1" ? [w1] : [])
    const result = buildSidebarOrder(items, sorted, [s1], members, [])
    expect(result).toEqual([
      { type: "local", id: "local" },
      { type: "wt", id: "w2" },
    ])
  })

  it("respects section order between sections and ungrouped worktrees", () => {
    const s1 = sec("s1", 0)
    const s2 = sec("s2", 1)
    const w1 = wt("w1", { sectionId: "s1" })
    const w2 = wt("w2")
    const w3 = wt("w3", { sectionId: "s2" })
    const sorted = [w1, w2, w3]
    const items = buildTopLevelItems([s1, s2], [w2], sorted, ["s1", "w2", "s2"])
    const members = (id: string) => {
      if (id === "s1") return [w1]
      if (id === "s2") return [w3]
      return []
    }
    const result = buildSidebarOrder(items, sorted, [s1, s2], members, [])
    expect(result.map((r) => r.id)).toEqual(["local", "w1", "w2", "w3"])
  })

  it("appends unassigned sessions after worktrees", () => {
    const sorted = [wt("a")]
    const items = buildTopLevelItems([], [], sorted, [])
    const sessions = [{ id: "sess1" }, { id: "sess2" }]
    const result = buildSidebarOrder(items, sorted, [], () => [], sessions)
    expect(result).toEqual([
      { type: "local", id: "local" },
      { type: "wt", id: "a" },
      { type: "session", id: "sess1" },
      { type: "session", id: "sess2" },
    ])
  })
})

describe("buildShortcutMap", () => {
  it("assigns 1-based shortcuts up to 9", () => {
    const order = [
      { type: "local" as const, id: "local" },
      { type: "wt" as const, id: "a" },
      { type: "wt" as const, id: "b" },
    ]
    const map = buildShortcutMap(order)
    expect(map.get("local")).toBe(1)
    expect(map.get("a")).toBe(2)
    expect(map.get("b")).toBe(3)
  })

  it("caps at 9 shortcuts", () => {
    const order = Array.from({ length: 12 }, (_, i) => ({
      type: "wt" as const,
      id: `w${i}`,
    }))
    const map = buildShortcutMap(order)
    expect(map.size).toBe(9)
    expect(map.has("w9")).toBe(false)
  })
})
