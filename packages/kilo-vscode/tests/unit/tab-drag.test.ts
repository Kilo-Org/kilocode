import { describe, it, expect } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { createTabDrag } from "../../webview-ui/agent-manager/tab-drag"
import { applyPinnedTabs, applyTabOrder } from "../../webview-ui/agent-manager/tab-order"

const KEY = "wt-1"

/**
 * Drives `createTabDrag` with plain signals.
 *
 * The tab bar renders pinned tabs first, but `tabOrder` is the pin-independent
 * sequence: it feeds `firstOrderedTitle` for worktree labels and decides where
 * a tab lands once it is unpinned. A drag must never write the rendered
 * grouping back into it.
 *
 * Assertions read the signals rather than `drag.ids()`, because the memo in
 * this test environment resolves once instead of tracking.
 */
function scene(init: { sessions: string[]; order?: string[]; pinned?: string[] }) {
  const [order, setOrder] = createSignal<Record<string, string[]>>(init.order ? { [KEY]: init.order } : {})
  const [pinned, setPinned] = createSignal<Record<string, string[]>>(init.pinned ? { [KEY]: init.pinned } : {})
  const persisted: { key: string; order: string[] }[] = []
  const drag = createTabDrag({
    selection: () => KEY,
    sessions: () => init.sessions.map((id) => ({ id })),
    review: { id: "review", open: () => false, title: () => "Review" },
    order,
    setOrder,
    pinned,
    setPinned,
    setLocal: () => {},
    terms: { current: () => [], reorder: () => {}, title: () => undefined } as never,
    namespace: (key) => key,
    persist: (key, next) => persisted.push({ key, order: [...next] }),
    persistPinned: () => {},
  })
  const move = (from: string, to: string) => drag.over({ draggable: { id: from }, droppable: { id: to } } as never)
  /** What the bar shows for the current signal state. */
  const shown = () =>
    applyPinnedTabs(
      applyTabOrder(
        init.sessions.map((id) => ({ id })),
        order()[KEY],
      ),
      pinned()[KEY],
    ).map((item) => item.id)
  return { drag, order, pinned, persisted, move, shown }
}

describe("createTabDrag with pinned tabs", () => {
  it("renders pinned tabs first without inventing a stored order", () => {
    createRoot((dispose) => {
      const { drag, order } = scene({ sessions: ["a", "b", "c", "d"], pinned: ["d"] })
      expect(drag.ids()).toEqual(["d", "a", "b", "c"])
      expect(order()[KEY]).toBeUndefined()
      dispose()
    })
  })

  it("keeps a pinned tab in its stored slot when an unpinned tab is dragged", () => {
    createRoot((dispose) => {
      const { order, move, shown } = scene({
        sessions: ["a", "b", "c", "d"],
        order: ["a", "b", "c", "d"],
        pinned: ["d"],
      })
      expect(shown()).toEqual(["d", "a", "b", "c"])

      // b moves in front of a. Both are unpinned, so only their relative
      // position may change; d keeps its stored slot at the tail.
      move("b", "a")

      expect(order()[KEY]).toEqual(["b", "a", "c", "d"])
      expect(shown()).toEqual(["d", "b", "a", "c"])
      dispose()
    })
  })

  it("returns an unpinned tab to the position the stored order gives it", () => {
    createRoot((dispose) => {
      const { order, pinned, move } = scene({
        sessions: ["a", "b", "c", "d"],
        order: ["a", "b", "c", "d"],
        pinned: ["d"],
      })
      move("b", "a")

      const restored = applyTabOrder(
        ["a", "b", "c", "d"].map((id) => ({ id })),
        order()[KEY],
      ).map((item) => item.id)

      expect(pinned()[KEY]).toEqual(["d"])
      expect(restored).toEqual(["b", "a", "c", "d"])
      dispose()
    })
  })

  it("reorders inside the pinned group and leaves the stored order alone", () => {
    createRoot((dispose) => {
      const { order, pinned, move, shown } = scene({
        sessions: ["a", "b", "c", "d"],
        order: ["a", "b", "c", "d"],
        pinned: ["c", "d"],
      })
      expect(shown()).toEqual(["c", "d", "a", "b"])

      move("d", "c")

      expect(pinned()[KEY]).toEqual(["d", "c"])
      expect(order()[KEY]).toEqual(["a", "b", "c", "d"])
      expect(shown()).toEqual(["d", "c", "a", "b"])
      dispose()
    })
  })

  it("does not let an unpinned tab cross into the pinned group", () => {
    createRoot((dispose) => {
      const { order, pinned, move } = scene({
        sessions: ["a", "b", "c", "d"],
        order: ["a", "b", "c", "d"],
        pinned: ["d"],
      })

      move("a", "d")

      expect(order()[KEY]).toEqual(["a", "b", "c", "d"])
      expect(pinned()[KEY]).toEqual(["d"])
      dispose()
    })
  })

  it("persists the ungrouped order when the drag ends", () => {
    createRoot((dispose) => {
      const { drag, persisted, move } = scene({
        sessions: ["a", "b", "c", "d"],
        order: ["a", "b", "c", "d"],
        pinned: ["d"],
      })
      move("b", "a")
      drag.end()

      expect(persisted).toEqual([{ key: KEY, order: ["b", "a", "c", "d"] }])
      dispose()
    })
  })
})
