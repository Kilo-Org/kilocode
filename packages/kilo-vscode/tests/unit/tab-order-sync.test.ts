import { describe, it, expect } from "bun:test"
import { createTabOrderSync, type TabOrderSyncDeps } from "../../webview-ui/agent-manager/tab-order-sync"
import { applyTabOrder } from "../../webview-ui/agent-manager/tab-order"

// Builds a simulated AgentManager tab state with controllable accessors.
// Mirrors the real call order: source state (localSessionIDs, terminals)
// is mutated BEFORE the factory method is invoked.
function scene(init: {
  order?: Record<string, string[]>
  sessions?: string[]
  worktreeSessions?: { key: string; ids: string[] }[]
  review?: Record<string, boolean>
  terminals?: Record<string, string[]>
}) {
  const state = {
    order: { ...(init.order ?? {}) } as Record<string, string[]>,
    localIds: [...(init.sessions ?? [])],
    worktreeSessions: init.worktreeSessions ?? [],
    review: init.review ?? {},
    terminals: { ...(init.terminals ?? {}) } as Record<string, string[]>,
    persisted: [] as { key: string; order: string[] }[],
  }
  const deps: TabOrderSyncDeps = {
    LOCAL: "LOCAL",
    REVIEW_TAB_ID: "review",
    order: () => state.order,
    setOrder: (u) => {
      state.order = u(state.order)
    },
    persist: (key, order) => {
      state.persisted.push({ key, order: [...order] })
    },
    localSessionIDs: () => state.localIds,
    sessions: () =>
      state.worktreeSessions.flatMap((w, wi) =>
        w.ids.map((id, i) => ({ id, createdAt: new Date(1700000000000 + wi * 1000 + i).toISOString() })),
      ),
    managedSessions: () => state.worktreeSessions.flatMap((w) => w.ids.map((id) => ({ id, worktreeId: w.key }))),
    reviewOpenByContext: () => state.review,
    terminalIdsFor: (key) => state.terminals[key] ?? [],
  }
  return { state, sync: createTabOrderSync(deps), deps }
}

// Simulate how `tabIds()` renders the final tab bar: base composed as
// `[...sessions, review, ...terminals]` and `applyTabOrder` layered on top.
function render(deps: TabOrderSyncDeps, key: string): string[] {
  const sids =
    key === deps.LOCAL
      ? deps.localSessionIDs()
      : deps
          .sessions()
          .filter((s) => deps.managedSessions().some((ms) => ms.id === s.id && ms.worktreeId === key))
          .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
          .map((s) => s.id)
  const withReview = deps.reviewOpenByContext()[key] === true ? [...sids, deps.REVIEW_TAB_ID] : sids
  const base = [...withReview, ...deps.terminalIdsFor(key)]
  return applyTabOrder(
    base.map((id) => ({ id })),
    deps.order()[key],
  ).map((i) => i.id)
}

describe("createTabOrderSync.append", () => {
  it("puts a new pending tab at the tail when a terminal already exists (regression)", () => {
    // Setup: existing session s1, existing terminal t1, no stored order yet
    // (terminal append was a no-op under the old logic because t1 was
    // already in base). User presses Cmd+T → pending_1 added to local
    // sessions first, then append is called.
    const { state, sync, deps } = scene({
      sessions: ["s1", "pending_1"],
      terminals: { LOCAL: ["t1"] },
    })
    sync.append("LOCAL", "pending_1")
    expect(render(deps, "LOCAL")).toEqual(["s1", "t1", "pending_1"])
    expect(state.order.LOCAL).toEqual(["s1", "t1", "pending_1"])
  })

  it("appends to tail when stored order exists and lacks the id", () => {
    const { state, sync, deps } = scene({
      order: { LOCAL: ["s1", "t1"] },
      sessions: ["s1", "s2"],
      terminals: { LOCAL: ["t1"] },
    })
    sync.append("LOCAL", "s2")
    expect(state.order.LOCAL).toEqual(["s1", "t1", "s2"])
    expect(render(deps, "LOCAL")).toEqual(["s1", "t1", "s2"])
  })

  it("moves the id to the tail if it was already present in stored", () => {
    const { state, sync } = scene({
      order: { LOCAL: ["s1", "s2", "t1"] },
      sessions: ["s1", "s2"],
      terminals: { LOCAL: ["t1"] },
    })
    sync.append("LOCAL", "s1")
    expect(state.order.LOCAL).toEqual(["s2", "t1", "s1"])
  })

  it("resolves undefined key to LOCAL", () => {
    const { state, sync } = scene({ sessions: ["s1"] })
    sync.append(undefined, "s1")
    expect(state.order.LOCAL).toEqual(["s1"])
  })

  it("handles an empty base (nothing mutated yet) by just writing the id", () => {
    const { state, sync } = scene({})
    sync.append("LOCAL", "x")
    expect(state.order.LOCAL).toEqual(["x"])
  })
})

describe("createTabOrderSync.replaceOrAppend", () => {
  it("swaps a pending id for a real session id, preserving position", () => {
    const { state, sync, deps } = scene({
      order: { LOCAL: ["s1", "pending_1", "t1"] },
      sessions: ["s1", "real_1"], // caller already mapped pending_1 → real_1
      terminals: { LOCAL: ["t1"] },
    })
    sync.replaceOrAppend("LOCAL", "pending_1", "real_1")
    expect(state.order.LOCAL).toEqual(["s1", "real_1", "t1"])
    expect(render(deps, "LOCAL")).toEqual(["s1", "real_1", "t1"])
  })

  it("appends at the tail when the anchor isn't in stored", () => {
    const { state, sync } = scene({
      order: { LOCAL: ["s1", "t1"] },
      sessions: ["s1", "s2"], // s2 not yet in stored
      terminals: { LOCAL: ["t1"] },
    })
    sync.replaceOrAppend("LOCAL", "missing", "s2")
    expect(state.order.LOCAL).toEqual(["s1", "t1", "s2"])
  })
})

describe("createTabOrderSync.insertAfter", () => {
  it("inserts a fork directly after its parent in the rendered order", () => {
    const { state, sync, deps } = scene({
      order: { LOCAL: ["s1", "t1"] },
      sessions: ["s1", "child", "s2"], // caller already inserted child after s1
      terminals: { LOCAL: ["t1"] },
    })
    sync.insertAfter("LOCAL", "s1", "child")
    expect(state.order.LOCAL).toEqual(["s1", "child", "t1", "s2"])
    // Rendered result has child immediately after s1.
    expect(render(deps, "LOCAL")).toEqual(["s1", "child", "t1", "s2"])
  })

  it("appends when the anchor is missing entirely", () => {
    const { state, sync } = scene({
      order: { LOCAL: ["s1"] },
      sessions: ["s1", "fork"],
    })
    sync.insertAfter("LOCAL", "missing_anchor", "fork")
    expect(state.order.LOCAL).toEqual(["s1", "fork"])
  })

  it("seeds from base when no stored order exists (first fork)", () => {
    const { state, sync } = scene({
      sessions: ["s1", "child", "s2"],
    })
    sync.insertAfter("LOCAL", "s1", "child")
    expect(state.order.LOCAL).toEqual(["s1", "child", "s2"])
  })
})

describe("createTabOrderSync persistence filter", () => {
  it("callers strip transient ids before persisting (review + terminal:* never hit disk)", () => {
    // Mirror AgentManagerApp's real filter: strip review + terminal ids.
    const { state, sync } = scene({
      sessions: ["s1", "pending_1"],
      terminals: { LOCAL: ["terminal:abc"] },
      review: { LOCAL: true },
    })
    // Rebuild sync with a filtering persist to mimic the call site.
    const filteredSync = createTabOrderSync({
      LOCAL: "LOCAL",
      REVIEW_TAB_ID: "review",
      order: () => state.order,
      setOrder: (u) => {
        state.order = u(state.order)
      },
      persist: (key, order) => {
        const clean = order.filter((id) => id !== "review" && !id.startsWith("terminal:"))
        state.persisted.push({ key, order: clean })
      },
      localSessionIDs: () => state.localIds,
      sessions: () => [],
      managedSessions: () => [],
      reviewOpenByContext: () => state.review,
      terminalIdsFor: (key) => state.terminals[key] ?? [],
    })
    filteredSync.append("LOCAL", "pending_1")
    // In-memory order still has terminals/review for drag state.
    expect(state.order.LOCAL).toEqual(["s1", "review", "terminal:abc", "pending_1"])
    // Persisted payload is session-only.
    expect(state.persisted.at(-1)?.order).toEqual(["s1", "pending_1"])
  })
})

describe("createTabOrderSync cross-method scenario", () => {
  it("preserves position through terminal → pending → real lifecycle", () => {
    const s = scene({ sessions: ["s1"] })

    // 1. Terminal created — caller added t1 to terms state first.
    s.state.terminals.LOCAL = ["t1"]
    s.sync.append("LOCAL", "t1")
    expect(s.state.order.LOCAL).toEqual(["s1", "t1"])

    // 2. User presses Cmd+T → pending_1 appended to localIds first.
    s.state.localIds = ["s1", "pending_1"]
    s.sync.append("LOCAL", "pending_1")
    expect(s.state.order.LOCAL).toEqual(["s1", "t1", "pending_1"])

    // 3. Real session created → caller mapped pending_1 → real_1 in localIds.
    s.state.localIds = ["s1", "real_1"]
    s.sync.replaceOrAppend("LOCAL", "pending_1", "real_1")
    expect(s.state.order.LOCAL).toEqual(["s1", "t1", "real_1"])

    // Rendered tab bar keeps the new session in its slot (right of t1).
    expect(render(s.deps, "LOCAL")).toEqual(["s1", "t1", "real_1"])
  })
})
