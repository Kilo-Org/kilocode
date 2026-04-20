import { describe, it, expect } from "bun:test"
import {
  resolveNavigation,
  validateLocalSession,
  adjacentHint,
  restoreLocalSessions,
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
