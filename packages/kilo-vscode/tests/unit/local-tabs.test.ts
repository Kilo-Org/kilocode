import { describe, expect, it } from "bun:test"
import {
  addPendingTab,
  addSessionTab,
  closeOtherTabs,
  closeTab,
  nextTabAfterClose,
  openSessionTab,
  insertSessionTabAfter,
  pendingTabForCreated,
  reconcileTabs,
  reconcileTrackedTabs,
  replacePendingTab,
  restoreTabs,
  restoreTrackedTabs,
  showTabStrip,
  trackedSessionInventory,
  type LocalTabState,
} from "../../webview-ui/src/utils/local-tabs"
import { reorderTabs } from "../../webview-ui/src/utils/tab-order"

const pending = (id = "sidebar-pending:1") => id
const makePending =
  (id = "sidebar-pending:1") =>
  () =>
    id

function state(ids: string[], active?: string): LocalTabState {
  return { ids, active }
}

const trackedPending = (id: string) => id.startsWith("pending-")
const identity = (items: { id: string }[], _order: string[]) => items
const reorder = (items: { id: string }[], order: string[]) => {
  const lookup = new Map(items.map((item) => [item.id, item]))
  const result: { id: string }[] = []
  for (const id of order) {
    const item = lookup.get(id)
    if (!item) continue
    result.push(item)
    lookup.delete(id)
  }
  for (const item of lookup.values()) result.push(item)
  return result
}
const inventory = (local: string[], external: string[] = []) => ({ local, external: new Set(external) })
const tracked = () =>
  trackedSessionInventory(
    [
      { id: "local", worktreeId: null },
      { id: "worktree", worktreeId: "wt-1" },
      { id: "sparse", worktreeId: null },
      { id: "child", worktreeId: "wt-1" },
    ],
    [
      { id: "local", parentID: null },
      { id: "worktree", parentID: null },
      { id: "sparse" },
      { id: "child", parentID: "root" },
    ],
  )

describe("local session tabs", () => {
  it("hides the tab strip when only one tab remains", () => {
    expect(showTabStrip([pending()])).toBe(false)
    expect(showTabStrip([pending(), "sidebar-pending:2"])).toBe(true)
    expect(showTabStrip(["s1"])).toBe(false)
    expect(showTabStrip(["s1", "s2"])).toBe(true)
  })

  it("restores a fresh pending tab when no sessions were persisted", () => {
    expect(restoreTabs(undefined, undefined, makePending())).toEqual({ ids: [pending()], active: pending() })
  })

  it("restores persisted local sessions and their active tab", () => {
    expect(restoreTabs(["s1", "s2"], "s2", makePending())).toEqual({ ids: ["s1", "s2"], active: "s2" })
  })

  it("promotes a pending tab into the created session without moving it", () => {
    const next = addPendingTab(state(["s1"], "s1"), pending())
    expect(replacePendingTab(next, pending(), "s2")).toEqual({ ids: ["s1", "s2"], active: "s2" })
  })

  it("adds another pending tab instead of reusing the active pending tab", () => {
    const first = addPendingTab(state(["s1"], "s1"), pending())
    expect(addPendingTab(first, "sidebar-pending:2")).toEqual({
      ids: ["s1", pending(), "sidebar-pending:2"],
      active: "sidebar-pending:2",
    })
  })

  it("focuses an already open session instead of duplicating it", () => {
    expect(openSessionTab(state(["s1", "s2"], "s1"), "s2")).toEqual({ ids: ["s1", "s2"], active: "s2" })
  })

  it("inserts a fork immediately after its source in a custom order", () => {
    expect(insertSessionTabAfter(state(["s3", "s1", "s2"], "s3"), "s1", "fork")).toEqual({
      ids: ["s3", "s1", "fork", "s2"],
      active: "fork",
    })
  })

  it("keeps repeated fork events idempotent", () => {
    const current = state(["s3", "s1", "fork", "s2"], "s1")
    expect(insertSessionTabAfter(current, "s1", "fork")).toEqual({ ids: current.ids, active: "fork" })
  })

  it("appends a fork when its source tab is no longer open", () => {
    expect(insertSessionTabAfter(state(["s1", "s2"], "s1"), "missing", "fork")).toEqual({
      ids: ["s1", "s2", "fork"],
      active: "fork",
    })
  })

  it("selects the neighboring tab after closing the active one", () => {
    expect(closeTab(state(["s1", "s2", "s3"], "s2"), "s2", makePending())).toEqual({
      ids: ["s1", "s3"],
      active: "s3",
    })
  })

  it("keeps an empty chat available after closing the final tab", () => {
    expect(closeTab(state(["s1"], "s1"), "s1", makePending())).toEqual({ ids: [pending()], active: pending() })
  })

  it("drops missing persisted sessions while preserving pending work", () => {
    expect(reconcileTabs(state(["s1", pending(), "gone"], "gone"), ["s1"], makePending("sidebar-pending:2"))).toEqual({
      ids: ["s1", pending()],
      active: "s1",
    })
  })

  it("promotes the targeted pending tab without changing a different active draft", () => {
    expect(replacePendingTab(state(["pending-1", "pending-2"], "pending-2"), "pending-1", "s1")).toEqual({
      ids: ["s1", "pending-2"],
      active: "pending-2",
    })
  })

  it("preserves a dragged pending tab position when it becomes a real session", () => {
    const ids = reorderTabs(["s1", pending(), "s2"], pending(), "s1")!
    expect(replacePendingTab(state(ids, pending()), pending(), "s3")).toEqual({
      ids: ["s3", "s1", "s2"],
      active: "s3",
    })
  })

  it("does not replace another pending tab when an explicit draft was closed", () => {
    expect(pendingTabForCreated(["sidebar-pending:2"], "sidebar-pending:1")).toBeUndefined()
    expect(pendingTabForCreated(["sidebar-pending:2"], undefined)).toBeUndefined()
  })

  it("adds a background session without changing the active tab", () => {
    expect(addSessionTab(state(["s1"], "s1"), "s2")).toEqual({ ids: ["s1", "s2"], active: "s1" })
  })

  it("closes every other tab and activates the retained tab", () => {
    expect(closeOtherTabs(state(["s1", pending(), "s2"], "s1"), pending())).toEqual({
      ids: [pending()],
      active: pending(),
    })
  })

  it("does not close tabs when the retained id is missing", () => {
    const current = state(["s1", "s2"], "s1")
    expect(closeOtherTabs(current, "missing")).toBe(current)
  })
})

describe("shared close selection", () => {
  it("prefers the next tab when closing a middle tab", () => {
    expect(nextTabAfterClose(["s1", "s2", "s3"], "s2")).toBe("s3")
  })

  it("falls back to the previous tab when closing the tail", () => {
    expect(nextTabAfterClose(["s1", "s2", "s3"], "s3")).toBe("s2")
  })

  it("returns undefined for a final or missing tab", () => {
    expect(nextTabAfterClose(["s1"], "s1")).toBeUndefined()
    expect(nextTabAfterClose(["s1"], "missing")).toBeUndefined()
  })
})

describe("tracked tab restore", () => {
  it("restores only sessions with known root ancestry", () => {
    expect(restoreTrackedTabs(tracked(), [], undefined, trackedPending, identity)).toEqual(["local"])
  })

  it("evicts sparse and child sessions from restored tabs", () => {
    expect(restoreTrackedTabs(tracked(), ["local", "sparse", "child"], undefined, trackedPending, identity)).toEqual([
      "local",
    ])
  })

  it("restores durable local sessions when the current list has no real tabs", () => {
    expect(restoreTrackedTabs(inventory(["s1", "s2"]), [], undefined, trackedPending, identity)).toEqual(["s1", "s2"])
  })

  it("skips externally owned sessions while restoring local sessions", () => {
    expect(restoreTrackedTabs(inventory(["s2"], ["s1", "s3"]), [], undefined, trackedPending, identity)).toEqual(["s2"])
  })

  it("evicts externally owned sessions already in the current local list", () => {
    expect(restoreTrackedTabs(inventory(["s1"], ["s2"]), ["s1", "s2"], undefined, trackedPending, identity)).toEqual([
      "s1",
    ])
  })

  it("applies durable ordering and merges sessions missing from stale webview state", () => {
    expect(
      restoreTrackedTabs(inventory(["s1", "s2", "s3"]), ["s1", "s2"], ["s3", "s1", "s2"], trackedPending, reorder),
    ).toEqual(["s3", "s1", "s2"])
  })

  it("does not overwrite an already-restored real list without a change", () => {
    expect(
      restoreTrackedTabs(inventory(["s1", "s2"]), ["s1", "s2"], undefined, trackedPending, identity),
    ).toBeUndefined()
  })

  it("restores disk sessions when current tabs are only pending drafts", () => {
    expect(restoreTrackedTabs(inventory(["s1", "s2"]), ["pending-1"], undefined, trackedPending, identity)).toEqual([
      "s1",
      "s2",
    ])
  })
})

describe("tracked tab reconcile", () => {
  it("evicts sparse sessions without forgetting them", () => {
    const data = trackedSessionInventory(
      [
        { id: "local", worktreeId: null },
        { id: "sparse", worktreeId: null },
      ],
      [{ id: "local", parentID: null }, { id: "sparse" }],
    )
    expect(reconcileTrackedTabs(["local", "sparse"], ["local"], data, trackedPending)).toEqual({
      ids: ["local"],
      forget: [],
    })
  })

  it("forgets explicit child sessions even when they only exist in managed state", () => {
    expect(reconcileTrackedTabs(["local"], ["local"], tracked(), trackedPending)).toEqual({
      ids: ["local"],
      forget: ["child"],
    })
  })

  it("preserves durable local sessions before loaded sessions include them", () => {
    expect(reconcileTrackedTabs(["s1", "s2"], [], inventory(["s1", "s2"]), trackedPending)).toBeUndefined()
  })

  it("forgets stale local sessions absent from loaded and durable state", () => {
    expect(reconcileTrackedTabs(["s1", "gone"], ["s1"], inventory(["s1"]), trackedPending)).toEqual({
      ids: ["s1"],
      forget: ["gone"],
    })
  })

  it("evicts external sessions without forgetting them", () => {
    expect(
      reconcileTrackedTabs(
        ["local-1", "worktree-1"],
        ["local-1", "worktree-1"],
        inventory(["local-1"], ["worktree-1"]),
        trackedPending,
      ),
    ).toEqual({ ids: ["local-1"], forget: [] })
  })

  it("keeps pending drafts while stale real sessions are forgotten", () => {
    expect(reconcileTrackedTabs(["pending-1", "gone"], [], inventory([]), trackedPending)).toEqual({
      ids: ["pending-1"],
      forget: ["gone"],
    })
  })
})
