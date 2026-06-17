import { describe, it, expect } from "bun:test"
import {
  adjacentHint,
  restoreLocalSessions,
  reconcileLocalSessions,
  filterUnassignedSessions,
  LOCAL,
} from "../../webview-ui/agent-manager/navigate"

describe("adjacentHint", () => {
  const flat = [LOCAL, "wt1", "wt2", "wt3", "s1"]

  it("returns prev hint when item is directly above active", () => {
    expect(adjacentHint("wt1", "wt2", flat, "⌘↑", "⌘↓")).toBe("⌘↑")
  })

  it("returns next hint when item is directly below active", () => {
    expect(adjacentHint("wt3", "wt2", flat, "⌘↑", "⌘↓")).toBe("⌘↓")
  })

  it("returns empty string for the active item itself", () => {
    expect(adjacentHint("wt2", "wt2", flat, "⌘↑", "⌘↓")).toBe("")
  })

  it("returns empty string for non-adjacent items", () => {
    expect(adjacentHint("wt1", "wt3", flat, "⌘↑", "⌘↓")).toBe("")
    expect(adjacentHint("s1", "wt1", flat, "⌘↑", "⌘↓")).toBe("")
  })

  it("returns empty string when active is undefined", () => {
    expect(adjacentHint("wt1", undefined, flat, "⌘↑", "⌘↓")).toBe("")
  })

  it("returns empty string when active is not in list", () => {
    expect(adjacentHint("wt1", "unknown", flat, "⌘↑", "⌘↓")).toBe("")
  })

  it("returns empty string when item is not in list", () => {
    expect(adjacentHint("unknown", "wt2", flat, "⌘↑", "⌘↓")).toBe("")
  })

  it("works at boundaries — first item with LOCAL active", () => {
    expect(adjacentHint("wt1", LOCAL, flat, "⌘↑", "⌘↓")).toBe("⌘↓")
  })

  it("works at boundaries — LOCAL with first item active", () => {
    expect(adjacentHint(LOCAL, "wt1", flat, "⌘↑", "⌘↓")).toBe("⌘↑")
  })

  it("works with single-item list", () => {
    expect(adjacentHint("a", "b", ["a", "b"], "prev", "next")).toBe("prev")
    expect(adjacentHint("b", "a", ["a", "b"], "prev", "next")).toBe("next")
  })
})

describe("filterUnassignedSessions", () => {
  const at = (day: number) => `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`
  const info = (id: string, day: number, parentID?: string | null) => ({
    id,
    createdAt: at(day),
    ...(parentID === undefined ? {} : { parentID }),
  })

  it("keeps root sessions with undefined parent IDs", () => {
    const result = filterUnassignedSessions([info("old", 1), info("new", 3)], new Set(), new Set())

    expect(result.map((s) => s.id)).toEqual(["new", "old"])
  })

  it("keeps root sessions with null parent IDs", () => {
    const result = filterUnassignedSessions([info("root", 1, null)], new Set(), new Set())

    expect(result.map((s) => s.id)).toEqual(["root"])
  })

  it("filters child sessions with parent IDs", () => {
    const result = filterUnassignedSessions(
      [info("parent", 2), info("child", 3, "parent"), info("orphan", 4, "missing")],
      new Set(),
      new Set(),
    )

    expect(result.map((s) => s.id)).toEqual(["parent"])
  })

  it("filters string parent IDs even when they are empty", () => {
    const result = filterUnassignedSessions([info("blank", 2, ""), info("root", 1)], new Set(), new Set())

    expect(result.map((s) => s.id)).toEqual(["root"])
  })

  it("filters worktree sessions while keeping other roots", () => {
    const result = filterUnassignedSessions(
      [info("root", 1), info("worktree", 3), info("other", 2)],
      new Set(["worktree"]),
      new Set(),
    )

    expect(result.map((s) => s.id)).toEqual(["other", "root"])
  })

  it("filters local tab sessions while keeping other roots", () => {
    const result = filterUnassignedSessions(
      [info("root", 1), info("local", 3), info("other", 2)],
      new Set(),
      new Set(["local"]),
    )

    expect(result.map((s) => s.id)).toEqual(["other", "root"])
  })

  it("applies child, worktree, and local filters before sorting", () => {
    const result = filterUnassignedSessions(
      [info("old-root", 1), info("child", 6, "old-root"), info("worktree", 5), info("local", 4), info("new-root", 3)],
      new Set(["worktree"]),
      new Set(["local"]),
    )

    expect(result.map((s) => s.id)).toEqual(["new-root", "old-root"])
  })

  it("returns an empty list when every session is filtered", () => {
    const result = filterUnassignedSessions(
      [info("child", 3, "root"), info("worktree", 2), info("local", 1)],
      new Set(["worktree"]),
      new Set(["local"]),
    )

    expect(result).toEqual([])
  })

  it("does not mutate the input order", () => {
    const sessions = [info("old", 1), info("new", 3), info("mid", 2)]

    filterUnassignedSessions(sessions, new Set(), new Set())

    expect(sessions.map((s) => s.id)).toEqual(["old", "new", "mid"])
  })

  it("preserves session objects and extra fields", () => {
    const root = { ...info("root", 1), title: "Existing session" }
    const result = filterUnassignedSessions([root], new Set(), new Set())

    expect(result[0]).toBe(root)
    expect(result[0]?.title).toBe("Existing session")
  })

  it("keeps a parent root when its child is filtered", () => {
    const result = filterUnassignedSessions([info("root", 1), info("child", 2, "root")], new Set(), new Set())

    expect(result.map((s) => s.id)).toEqual(["root"])
  })
})

describe("restoreLocalSessions", () => {
  const identity = (items: { id: string }[], _order: string[]) => items
  const isPending = (id: string) => id.startsWith("pending-")

  // Simulates applyTabOrder: reorders items to match the order array
  const reorder = (items: { id: string }[], order: string[]) => {
    const lookup = new Map(items.map((item) => [item.id, item]))
    const result: { id: string }[] = []
    for (const id of order) {
      const item = lookup.get(id)
      if (item) {
        result.push(item)
        lookup.delete(id)
      }
    }
    for (const item of lookup.values()) result.push(item)
    return result
  }

  it("restores local sessions when current list is empty", () => {
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: null },
    ]
    const result = restoreLocalSessions(sessions, [], undefined, isPending, identity)
    expect(result).toEqual(["s1", "s2"])
  })

  it("skips worktree-bound sessions", () => {
    const sessions = [
      { id: "s1", worktreeId: "wt-1" },
      { id: "s2", worktreeId: null },
      { id: "s3", worktreeId: "wt-2" },
    ]
    const result = restoreLocalSessions(sessions, [], undefined, isPending, identity)
    expect(result).toEqual(["s2"])
  })

  it("evicts worktree-bound sessions already in current local state", () => {
    // Regression: sessionCreated (SSE) can race ahead of agentManager.state and
    // wrongly add a worktree session to localSessionIDs. On the next state push
    // the worktree mapping arrives and the session must be evicted from local.
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: "wt-1" },
    ]
    const result = restoreLocalSessions(sessions, ["s1", "s2"], undefined, isPending, identity)
    expect(result).toEqual(["s1"])
  })

  it("applies tab order on restore", () => {
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: null },
      { id: "s3", worktreeId: null },
    ]
    const result = restoreLocalSessions(sessions, [], ["s3", "s1", "s2"], isPending, reorder)
    expect(result).toEqual(["s3", "s1", "s2"])
  })

  it("does not overwrite existing real sessions", () => {
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: null },
    ]
    // Current already has real sessions — don't replace
    const result = restoreLocalSessions(sessions, ["s1", "s2"], undefined, isPending, identity)
    expect(result).toBeUndefined()
  })

  it("does restore when current only has pending tabs", () => {
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: null },
    ]
    const result = restoreLocalSessions(sessions, ["pending-1"], undefined, isPending, identity)
    expect(result).toEqual(["s1", "s2"])
  })

  it("returns undefined when no local sessions and no tab order", () => {
    const sessions = [{ id: "s1", worktreeId: "wt-1" }]
    const result = restoreLocalSessions(sessions, [], undefined, isPending, identity)
    expect(result).toBeUndefined()
  })

  it("applies tab order to existing sessions", () => {
    const sessions = [{ id: "s1", worktreeId: null }]
    const result = restoreLocalSessions(sessions, ["s2", "s1"], ["s1", "s2"], isPending, reorder)
    expect(result).toEqual(["s1", "s2"])
  })

  it("merges disk session missing from stale webview state", () => {
    const sessions = [
      { id: "s1", worktreeId: null },
      { id: "s2", worktreeId: null },
      { id: "s3", worktreeId: null },
    ]
    // webview state is stale: has s1, s2 but not s3 (debounce didn't fire)
    const result = restoreLocalSessions(sessions, ["s1", "s2"], undefined, isPending, identity)
    expect(result).toEqual(["s1", "s2", "s3"])
  })

  it("returns undefined when no disk sessions and no tab order", () => {
    const result = restoreLocalSessions([], [], undefined, isPending, identity)
    expect(result).toBeUndefined()
  })
})

describe("reconcileLocalSessions", () => {
  const isPending = (id: string) => id.startsWith("pending-")

  it("keeps restored local sessions through a partial restart refresh", () => {
    const managed = [
      { id: "local-1", worktreeId: null },
      { id: "worktree-1", worktreeId: "wt-1" },
    ]
    const restored = restoreLocalSessions(managed, [], undefined, isPending, (items) => items)?.filter(Boolean) ?? []

    const result = reconcileLocalSessions(restored, ["worktree-1"], managed, isPending)

    expect(restored).toEqual(["local-1"])
    expect(result).toBeUndefined()
  })

  it("preserves restored local sessions before sessionsLoaded includes them", () => {
    const result = reconcileLocalSessions(
      ["s1", "s2"],
      [],
      [
        { id: "s1", worktreeId: null },
        { id: "s2", worktreeId: null },
      ],
      isPending,
    )

    expect(result).toBeUndefined()
  })

  it("does not forget persisted local sessions when only worktree sessions loaded", () => {
    const result = reconcileLocalSessions(
      ["local-1"],
      ["worktree-1"],
      [
        { id: "local-1", worktreeId: null },
        { id: "worktree-1", worktreeId: "wt-1" },
      ],
      isPending,
    )

    expect(result).toBeUndefined()
  })

  it("waits for managed state before removing sessions restored from webview state", () => {
    const beforeState = reconcileLocalSessions(["local-1"], ["worktree-1"], [], isPending)
    const afterState = reconcileLocalSessions(
      ["local-1"],
      ["worktree-1"],
      [
        { id: "local-1", worktreeId: null },
        { id: "worktree-1", worktreeId: "wt-1" },
      ],
      isPending,
    )

    expect(beforeState).toEqual({ ids: [], forget: ["local-1"] })
    expect(afterState).toBeUndefined()
  })

  it("forgets stale local sessions missing from loaded and managed state", () => {
    const result = reconcileLocalSessions(["s1", "gone"], ["s1"], [{ id: "s1", worktreeId: null }], isPending)

    expect(result).toEqual({ ids: ["s1"], forget: ["gone"] })
  })

  it("evicts worktree sessions that raced into local state without forgetting them", () => {
    const result = reconcileLocalSessions(
      ["local-1", "worktree-1"],
      ["local-1", "worktree-1"],
      [
        { id: "local-1", worktreeId: null },
        { id: "worktree-1", worktreeId: "wt-1" },
      ],
      isPending,
    )

    expect(result).toEqual({ ids: ["local-1"], forget: [] })
  })

  it("keeps pending local tabs during reconciliation", () => {
    const result = reconcileLocalSessions(["pending-1", "gone"], [], [], isPending)

    expect(result).toEqual({ ids: ["pending-1"], forget: ["gone"] })
  })
})
