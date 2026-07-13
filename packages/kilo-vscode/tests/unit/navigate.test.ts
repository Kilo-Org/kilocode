import { describe, it, expect } from "bun:test"
import {
  resolveNavigation,
  validateLocalSession,
  adjacentHint,
  filterUnassignedSessions,
  remoteSessions,
  LOCAL,
} from "../../webview-ui/agent-manager/navigate"

const ids = ["a", "b", "c", "d"]

describe("resolveNavigation", () => {
  describe("from local (current = undefined)", () => {
    it("down → selects first session", () => {
      expect(resolveNavigation("down", undefined, ids)).toEqual({ action: "select", id: "a" })
    })

    it("up → none (already at top)", () => {
      expect(resolveNavigation("up", undefined, ids)).toEqual({ action: "none" })
    })

    it("down with empty list → none", () => {
      expect(resolveNavigation("down", undefined, [])).toEqual({ action: "none" })
    })

    it("up with empty list → none", () => {
      expect(resolveNavigation("up", undefined, [])).toEqual({ action: "none" })
    })
  })

  describe("from first session", () => {
    it("up → local", () => {
      expect(resolveNavigation("up", "a", ids)).toEqual({ action: LOCAL })
    })

    it("down → selects second session", () => {
      expect(resolveNavigation("down", "a", ids)).toEqual({ action: "select", id: "b" })
    })
  })

  describe("from middle session", () => {
    it("up → selects previous session", () => {
      expect(resolveNavigation("up", "b", ids)).toEqual({ action: "select", id: "a" })
    })

    it("down → selects next session", () => {
      expect(resolveNavigation("down", "b", ids)).toEqual({ action: "select", id: "c" })
    })
  })

  describe("from last session", () => {
    it("down → none (already at bottom)", () => {
      expect(resolveNavigation("down", "d", ids)).toEqual({ action: "none" })
    })

    it("up → selects previous session", () => {
      expect(resolveNavigation("up", "d", ids)).toEqual({ action: "select", id: "c" })
    })
  })

  describe("current session not in list", () => {
    it("down → none", () => {
      expect(resolveNavigation("down", "unknown", ids)).toEqual({ action: "none" })
    })

    it("up → none", () => {
      expect(resolveNavigation("up", "unknown", ids)).toEqual({ action: "none" })
    })
  })

  describe("single session list", () => {
    it("down from local → selects only session", () => {
      expect(resolveNavigation("down", undefined, ["x"])).toEqual({ action: "select", id: "x" })
    })

    it("up from only session → local", () => {
      expect(resolveNavigation("up", "x", ["x"])).toEqual({ action: LOCAL })
    })

    it("down from only session → none", () => {
      expect(resolveNavigation("down", "x", ["x"])).toEqual({ action: "none" })
    })
  })

  describe("sequential walk-through", () => {
    it("navigating down through entire list then back up returns to local", () => {
      const sessions = ["s1", "s2", "s3"]
      const trail: string[] = []

      // Start at local, navigate down through all sessions
      let current: string | undefined = undefined
      for (let i = 0; i < 4; i++) {
        const result = resolveNavigation("down", current, sessions)
        if (result.action === "select") {
          current = result.id
          trail.push(current)
        } else {
          break
        }
      }
      expect(trail).toEqual(["s1", "s2", "s3"])

      // Navigate back up through all sessions to local
      const upTrail: (string | typeof LOCAL)[] = []
      for (let i = 0; i < 4; i++) {
        const result = resolveNavigation("up", current, sessions)
        if (result.action === "select") {
          current = result.id
          upTrail.push(current)
        } else if (result.action === LOCAL) {
          current = undefined
          upTrail.push(LOCAL)
        } else {
          break
        }
      }
      expect(upTrail).toEqual(["s2", "s1", LOCAL])
    })
  })
})

describe("validateLocalSession", () => {
  it("returns the ID when it exists in the sessions list", () => {
    expect(validateLocalSession("abc", ["abc", "def"])).toBe("abc")
  })

  it("returns undefined when the ID is not in the sessions list (stale/deleted)", () => {
    expect(validateLocalSession("gone", ["abc", "def"])).toBeUndefined()
  })

  it("returns undefined when sessions list is empty", () => {
    expect(validateLocalSession("abc", [])).toBeUndefined()
  })

  it("returns undefined when persisted ID is undefined", () => {
    expect(validateLocalSession(undefined, ["abc"])).toBeUndefined()
  })

  it("returns undefined when both are empty/undefined", () => {
    expect(validateLocalSession(undefined, [])).toBeUndefined()
  })
})

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

describe("remoteSessions", () => {
  const pending = (id: string) => id.startsWith("pending:")

  it("returns every real tab without collapsing sessions in the same worktree", () => {
    const result = remoteSessions(
      ["local-1", "pending:1", "shared"],
      [
        { id: "shared", worktreeId: "wt-1" },
        { id: "worktree-1", worktreeId: "wt-1" },
        { id: "worktree-2", worktreeId: "wt-1" },
        { id: "worktree-3", worktreeId: "wt-2" },
        { id: "closed-local", worktreeId: null },
      ],
      pending,
    )

    expect(result).toEqual(["local-1", "shared", "worktree-1", "worktree-2", "worktree-3"])
  })

  it("returns an empty list without open sessions", () => {
    expect(remoteSessions([], [], pending)).toEqual([])
  })
})
