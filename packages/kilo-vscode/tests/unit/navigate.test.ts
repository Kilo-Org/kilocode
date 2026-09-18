import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { createRoot } from "solid-js"
import {
  resolveNavigation,
  validateLocalSession,
  adjacentHint,
  canOpenRootSession,
  remoteSessions,
  buildProjectNavOrder,
  resolveProjectNav,
  localNavId,
  worktreeNavId,
  type ProjectNavInput,
  LOCAL,
} from "../../webview-ui/agent-manager/navigate"
import { createProjectNav, type NavTarget } from "../../webview-ui/agent-manager/project-nav"
import type { SidebarItem } from "../../webview-ui/agent-manager/section-helpers"
import type {
  AgentManagerStateMessage,
  AgentProjectSnapshot,
  ProjectSessionInfo,
} from "../../webview-ui/src/types/messages"

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

describe("canOpenRootSession", () => {
  const sessions = [{ id: "root", parentID: null }, { id: "child", parentID: "root" }, { id: "sparse" }]

  it("only opens sessions with known root ancestry", () => {
    expect(canOpenRootSession("root", sessions)).toBe(true)
    expect(canOpenRootSession("child", sessions)).toBe(false)
    expect(canOpenRootSession("sparse", sessions)).toBe(false)
    expect(canOpenRootSession("missing", sessions)).toBe(false)
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

describe("buildProjectNavOrder", () => {
  it("builds A Local -> A worktree -> B Local -> B worktree across expanded projects", () => {
    const order = buildProjectNavOrder([
      { id: "A", expanded: true, worktrees: [{ id: "aw1" }], sections: [] },
      { id: "B", expanded: true, worktrees: [{ id: "bw1" }], sections: [] },
    ])

    expect(order.map((e) => e.id)).toEqual([
      localNavId("A"),
      worktreeNavId("A", "aw1"),
      localNavId("B"),
      worktreeNavId("B", "bw1"),
    ])
    expect(order.map((e) => e.target)).toEqual([
      { projectId: "A", kind: "local" },
      { projectId: "A", kind: "worktree", worktreeId: "aw1" },
      { projectId: "B", kind: "local" },
      { projectId: "B", kind: "worktree", worktreeId: "bw1" },
    ])
  })

  it("uses project-qualified composite ids, never raw worktree ids", () => {
    const order = buildProjectNavOrder([{ id: "A", expanded: true, worktrees: [{ id: "aw1" }], sections: [] }])
    const ids = order.map((e) => e.id)
    expect(ids).not.toContain("aw1")
    expect(ids).toContain("A:local")
    expect(ids).toContain("A:wt:aw1")
  })

  it("excludes collapsed projects entirely", () => {
    const order = buildProjectNavOrder([
      { id: "A", expanded: true, worktrees: [{ id: "aw1" }], sections: [] },
      { id: "C", expanded: false, worktrees: [{ id: "cw1" }], sections: [] },
    ])
    expect(order.map((e) => e.id)).toEqual([localNavId("A"), worktreeNavId("A", "aw1")])
    expect(order.some((e) => e.target.kind === "worktree" && e.target.worktreeId === "cw1")).toBe(false)
  })

  it("excludes worktrees inside collapsed sections but keeps ungrouped ones", () => {
    const order = buildProjectNavOrder([
      {
        id: "A",
        expanded: true,
        worktrees: [{ id: "aw1", sectionId: "s1" }, { id: "aw2" }],
        sections: [{ id: "s1", collapsed: true }],
      },
    ])
    expect(order.map((e) => e.id)).toEqual([localNavId("A"), worktreeNavId("A", "aw2")])
  })

  it("renders ungrouped worktrees before section members (matching the project body)", () => {
    const order = buildProjectNavOrder([
      {
        id: "A",
        expanded: true,
        worktrees: [{ id: "aw1", sectionId: "s1" }, { id: "aw2" }],
        sections: [{ id: "s1", collapsed: false }],
      },
    ])
    expect(order.map((e) => e.id)).toEqual([localNavId("A"), worktreeNavId("A", "aw2"), worktreeNavId("A", "aw1")])
  })

  it("follows persisted top-level section order and worktree order", () => {
    const order = buildProjectNavOrder([
      {
        id: "A",
        expanded: true,
        worktrees: [{ id: "aw1", sectionId: "s1" }, { id: "aw2" }, { id: "aw3", sectionId: "s2" }],
        worktreeOrder: ["aw2", "s2", "s1", "aw3", "aw1"],
        sections: [
          { id: "s1", collapsed: false },
          { id: "s2", collapsed: false },
        ],
      },
    ])

    expect(order.map((e) => e.id)).toEqual([
      localNavId("A"),
      worktreeNavId("A", "aw2"),
      worktreeNavId("A", "aw3"),
      worktreeNavId("A", "aw1"),
    ])
  })

  it("keeps multi-version worktrees adjacent", () => {
    const order = buildProjectNavOrder([
      {
        id: "A",
        expanded: true,
        worktrees: [{ id: "aw1", groupId: "g" }, { id: "aw2" }, { id: "aw3", groupId: "g" }],
        worktreeOrder: ["aw1", "aw2", "aw3"],
        sections: [],
      },
    ])

    expect(order.map((e) => e.id)).toEqual([
      localNavId("A"),
      worktreeNavId("A", "aw1"),
      worktreeNavId("A", "aw3"),
      worktreeNavId("A", "aw2"),
    ])
  })

  it("matches raw ungrouped order when sections are present", () => {
    const order = buildProjectNavOrder([
      {
        id: "A",
        expanded: true,
        worktrees: [
          { id: "aw1", groupId: "g" },
          { id: "aw2" },
          { id: "aw3", groupId: "g" },
          { id: "aw4", sectionId: "s1" },
        ],
        worktreeOrder: ["aw1", "aw2", "aw3", "s1", "aw4"],
        sections: [{ id: "s1", collapsed: false }],
      },
    ])

    expect(order.map((e) => e.id)).toEqual([
      localNavId("A"),
      worktreeNavId("A", "aw1"),
      worktreeNavId("A", "aw2"),
      worktreeNavId("A", "aw3"),
      worktreeNavId("A", "aw4"),
    ])
  })

  it("returns an empty order when every project is collapsed", () => {
    const order = buildProjectNavOrder([{ id: "A", expanded: false, worktrees: [{ id: "aw1" }], sections: [] }])
    expect(order).toEqual([])
  })
})

describe("resolveProjectNav", () => {
  // A Local -> A worktree -> B Local -> B worktree
  const inputs: ProjectNavInput[] = [
    { id: "A", expanded: true, worktrees: [{ id: "aw1" }], sections: [] },
    { id: "B", expanded: true, worktrees: [{ id: "bw1" }], sections: [] },
  ]
  const order = buildProjectNavOrder(inputs)
  // Collapsed project C must not appear in the order
  const withCollapsed = buildProjectNavOrder([
    ...inputs,
    { id: "C", expanded: false, worktrees: [{ id: "cw1" }], sections: [] },
  ])

  it("walks forward A Local -> A worktree -> B Local -> B worktree", () => {
    let current: string | undefined = undefined
    const trail: string[] = []
    for (let i = 0; i < 6; i++) {
      const entry = resolveProjectNav("down", current, order)
      if (!entry) break
      current = entry.id
      trail.push(entry.id)
    }
    expect(trail).toEqual([localNavId("A"), worktreeNavId("A", "aw1"), localNavId("B"), worktreeNavId("B", "bw1")])
  })

  it("walks in reverse B worktree -> B Local -> A worktree -> A Local", () => {
    let current: string | undefined = worktreeNavId("B", "bw1")
    const trail: string[] = [current]
    for (let i = 0; i < 6; i++) {
      const entry = resolveProjectNav("up", current, order)
      if (!entry) break
      current = entry.id
      trail.push(current)
    }
    expect(trail).toEqual([worktreeNavId("B", "bw1"), localNavId("B"), worktreeNavId("A", "aw1"), localNavId("A")])
  })

  it("returns undefined at the top boundary (up from first)", () => {
    expect(resolveProjectNav("up", localNavId("A"), order)).toBeUndefined()
  })

  it("returns undefined at the bottom boundary (down from last)", () => {
    expect(resolveProjectNav("down", worktreeNavId("B", "bw1"), order)).toBeUndefined()
  })

  it("does not wrap around", () => {
    expect(resolveProjectNav("up", localNavId("A"), order)).toBeUndefined()
    expect(resolveProjectNav("down", worktreeNavId("B", "bw1"), order)).toBeUndefined()
  })

  it("treats an unknown current as before-first (down -> first, up -> undefined)", () => {
    expect(resolveProjectNav("down", "unknown", order)?.id).toBe(localNavId("A"))
    expect(resolveProjectNav("up", "unknown", order)).toBeUndefined()
  })

  it("treats undefined current as before-first", () => {
    expect(resolveProjectNav("down", undefined, order)?.id).toBe(localNavId("A"))
    expect(resolveProjectNav("up", undefined, order)).toBeUndefined()
  })

  it("returns undefined for an empty order", () => {
    expect(resolveProjectNav("down", localNavId("A"), [])).toBeUndefined()
    expect(resolveProjectNav("up", undefined, [])).toBeUndefined()
  })

  it("collapsed project C is excluded from the order", () => {
    expect(withCollapsed.length).toBe(order.length)
    expect(withCollapsed.some((e) => e.id === worktreeNavId("C", "cw1"))).toBe(false)
    // Forward walk still ends at B worktree, never reaching C
    let current: string | undefined = undefined
    let last: string | undefined
    for (let i = 0; i < 10; i++) {
      const entry = resolveProjectNav("down", current, withCollapsed)
      if (!entry) break
      current = entry.id
      last = entry.id
    }
    expect(last).toBe(worktreeNavId("B", "bw1"))
  })
})

describe("createProjectNav", () => {
  // activate() schedules a DOM scroll via requestAnimationFrame; bun:test has
  // no DOM/rAF, so stub rAF to a no-op. The atomic `post` callback fires before
  // rAF, so targets are still observable. (solid-js resolves to its server
  // build under bun, where createMemo is one-shot, so each helper below builds
  // a fresh controller per call — mirroring one activation per keypress.)
  let raf: typeof globalThis.requestAnimationFrame | undefined
  beforeEach(() => {
    raf = globalThis.requestAnimationFrame
    globalThis.requestAnimationFrame = (() => 0) as never
  })
  afterEach(() => {
    globalThis.requestAnimationFrame = raf
  })

  const project = (id: string, expanded: boolean): AgentProjectSnapshot =>
    ({
      id,
      root: `/${id}`,
      label: id,
      pinned: false,
      active: id === "A",
      expanded,
      initialized: true,
      missing: false,
    }) as AgentProjectSnapshot

  const state = (
    worktrees: { id: string; sectionId?: string }[],
    sessions: { id: string; worktreeId: string | null }[],
    sections: { id: string; collapsed: boolean }[] = [],
  ): AgentManagerStateMessage =>
    ({
      type: "agentManager.state",
      worktrees: worktrees as never,
      sessions: sessions as never,
      sections,
    }) as AgentManagerStateMessage

  // A (expanded): worktree aw1. B (expanded): worktree bw1.
  // C (collapsed): worktree cw1 — must never be reached.
  const projects = () => [project("A", true), project("B", true), project("C", false)]
  const states = () => ({
    A: state([{ id: "aw1" }], []),
    B: state([{ id: "bw1" }], [{ id: "bs1", worktreeId: null }]),
    C: state([{ id: "cw1" }], []),
  })

  const run = (
    fn: (nav: ReturnType<typeof createProjectNav>) => void,
    selection: typeof LOCAL | string | null,
    activeProjectId: string | undefined,
    currentSessionID: string | undefined,
    post: (t: NavTarget) => void = () => {},
    focus: (item: SidebarItem) => void = () => {},
    multiProject = true,
    sidebarOrder: () => SidebarItem[] = () => [],
  ) =>
    createRoot((dispose) => {
      fn(
        createProjectNav(
          {
            multiProject: () => multiProject,
            sidebarOrder,
            focus,
            projects,
            states,
            activeProjectId: () => activeProjectId,
            selection: () => selection,
            currentSessionID: () => currentSessionID,
          },
          post,
          () => {},
        ),
      )
      dispose()
    })

  const stepOnce = (
    direction: "up" | "down",
    selection: typeof LOCAL | string | null,
    activeProjectId: string | undefined,
    currentSessionID: string | undefined,
  ): NavTarget | undefined => {
    let posted: NavTarget | undefined
    run(
      (nav) => nav.step(direction),
      selection,
      activeProjectId,
      currentSessionID,
      (t) => (posted = t),
    )
    return posted
  }

  const jumpOnce = (index: number): NavTarget | undefined => {
    let posted: NavTarget | undefined
    run(
      (nav) => nav.jump(index),
      LOCAL,
      "A",
      undefined,
      (t) => (posted = t),
    )
    return posted
  }

  it("multi-project step traverses A Local -> A worktree -> B Local -> B worktree", () => {
    expect(stepOnce("down", LOCAL, "A", undefined)).toEqual({ projectId: "A", kind: "worktree", worktreeId: "aw1" })
    expect(stepOnce("down", "aw1", "A", undefined)).toEqual({ projectId: "B", kind: "local" })
    expect(stepOnce("down", LOCAL, "B", undefined)).toEqual({ projectId: "B", kind: "worktree", worktreeId: "bw1" })
    expect(stepOnce("down", "bw1", "B", undefined)).toBeUndefined()
  })

  it("multi-project step treats a local session tab as B Local", () => {
    expect(stepOnce("down", null, "B", "bs1")).toEqual({ projectId: "B", kind: "worktree", worktreeId: "bw1" })
    expect(stepOnce("up", null, "B", "bs1")).toEqual({ projectId: "A", kind: "worktree", worktreeId: "aw1" })
  })

  it("multi-project step reverses B worktree -> B Local -> A worktree -> A Local", () => {
    expect(stepOnce("up", "bw1", "B", undefined)).toEqual({ projectId: "B", kind: "local" })
    expect(stepOnce("up", LOCAL, "B", undefined)).toEqual({ projectId: "A", kind: "worktree", worktreeId: "aw1" })
    expect(stepOnce("up", "aw1", "A", undefined)).toEqual({ projectId: "A", kind: "local" })
    expect(stepOnce("up", LOCAL, "A", undefined)).toBeUndefined()
  })

  it("collapsed project C is never reached via jump", () => {
    // Global order: A:local(0), A:aw1(1), B:local(2), B:bw1(3).
    expect(jumpOnce(0)).toEqual({ projectId: "A", kind: "local" })
    expect(jumpOnce(1)).toEqual({ projectId: "A", kind: "worktree", worktreeId: "aw1" })
    expect(jumpOnce(2)).toEqual({ projectId: "B", kind: "local" })
    expect(jumpOnce(3)).toEqual({ projectId: "B", kind: "worktree", worktreeId: "bw1" })
    // Past the end — and C's collapsed worktree is never reachable by any index.
    expect(jumpOnce(4)).toBeUndefined()
    expect(jumpOnce(99)).toBeUndefined()
  })

  it("multi-project jump targets the global order by index (⌘3 = B Local)", () => {
    expect(jumpOnce(2)).toEqual({ projectId: "B", kind: "local" })
  })

  it("single-project mode keeps the legacy in-process traversal and never posts activateSelection", () => {
    const order: SidebarItem[] = [
      { type: "local", id: "local" },
      { type: "wt", id: "w1" },
      { type: "session", id: "s1" },
    ]
    const focused: SidebarItem[] = []
    const posted: NavTarget[] = []
    const focus = (item: SidebarItem) => focused.push(item)
    const post = (t: NavTarget) => posted.push(t)
    run(
      (nav) => nav.step("down"),
      LOCAL,
      "A",
      undefined,
      post,
      focus,
      false,
      () => order,
    )
    expect(focused.pop()).toEqual({ type: "wt", id: "w1" })
    run(
      (nav) => nav.jump(2),
      "w1",
      "A",
      undefined,
      post,
      focus,
      false,
      () => order,
    )
    expect(focused.pop()).toEqual({ type: "session", id: "s1" })
    // Legacy path never dispatches the multi-project activation message.
    expect(posted).toEqual([])
  })
})
