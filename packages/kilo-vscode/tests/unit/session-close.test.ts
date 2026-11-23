import { describe, expect, it } from "bun:test"
import { closableRight, closeToRight, sessionCloseDeps } from "../../webview-ui/src/utils/session-close"

const PENDING = "sidebar-pending:1"

/**
 * Fake session-only tab bar for the sidebar: no terminals or review tab, and a
 * close picks a neighbor only when the active tab itself closes.
 */
function scene(ids: string[], opts: { active?: string; pins?: string[] } = {}) {
  const open = [...ids]
  const calls: string[] = []
  const pins = new Set(opts.pins ?? [])
  let active = opts.active
  const remove = (id: string) => {
    const index = open.indexOf(id)
    if (index >= 0) open.splice(index, 1)
  }
  const close = (id: string) => {
    calls.push(`close:${id}`)
    const wasActive = active === id
    const index = open.indexOf(id)
    remove(id)
    if (!wasActive) return
    active = open[Math.min(index, open.length - 1)]
  }
  const reveal = (id: string) => {
    calls.push(`reveal:${id}`)
    active = id
  }
  const deps = sessionCloseDeps({
    ids: () => [...open],
    visible: () => active,
    isPending: (id) => id.startsWith("sidebar-pending:"),
    isPinned: (id) => pins.has(id),
    close,
    reveal,
  })
  return { deps, calls, open, visible: () => active }
}

describe("session close deps", () => {
  it("reports pending tabs through the shared contract", () => {
    const s = scene(["a", PENDING])
    expect(s.deps.isPending(PENDING)).toBe(true)
    expect(s.deps.isPending("a")).toBe(false)
  })
})

describe("sidebar closable right", () => {
  it("returns every tab after the target in order", () => {
    const s = scene(["a", "b", "c", "d"])
    expect(closableRight("b", s.deps)).toEqual(["c", "d"])
  })

  it("returns nothing for the last tab or an unknown target", () => {
    const s = scene(["a", "b"])
    expect(closableRight("b", s.deps)).toEqual([])
    expect(closableRight("x", s.deps)).toEqual([])
  })

  it("skips pinned tabs to the right", () => {
    const s = scene(["a", PENDING, "c"], { pins: ["c"] })
    expect(closableRight("a", s.deps)).toEqual([PENDING])
  })

  it("returns nothing when only pinned tabs are to the right", () => {
    const s = scene(["a", "b"], { pins: ["b"] })
    expect(closableRight("a", s.deps)).toEqual([])
  })
})

describe("sidebar close to right", () => {
  it("closes only the trailing tabs and leaves the visible tab alone", () => {
    const s = scene(["a", "b", "c", "d"], { active: "a" })

    closeToRight("b", s.deps)

    expect(s.calls).toEqual(["close:c", "close:d"])
    expect(s.open).toEqual(["a", "b"])
    expect(s.visible()).toBe("a")
  })

  it("keeps pinned tabs to the right open", () => {
    const s = scene(["a", "b", "c", "d"], { active: "a", pins: ["c"] })

    closeToRight("b", s.deps)

    expect(s.calls).toEqual(["close:d"])
    expect(s.open).toEqual(["a", "b", "c"])
    expect(s.visible()).toBe("a")
  })

  it("moves selection to the target only when the visible tab closes", () => {
    const s = scene(["a", "b", "c"], { active: "c" })

    closeToRight("b", s.deps)

    expect(s.calls).toEqual(["reveal:b", "close:c"])
    expect(s.open).toEqual(["a", "b"])
    expect(s.visible()).toBe("b")
  })

  it("does nothing when the target is the last tab", () => {
    const s = scene(["a", "b"], { active: "a" })

    closeToRight("b", s.deps)

    expect(s.calls).toEqual([])
    expect(s.open).toEqual(["a", "b"])
  })

  it("does nothing when only pinned tabs are to the right", () => {
    const s = scene(["a", "b"], { active: "a", pins: ["b"] })

    closeToRight("a", s.deps)

    expect(s.calls).toEqual([])
    expect(s.open).toEqual(["a", "b"])
  })

  it("closes a pending draft to the right", () => {
    const s = scene(["a", PENDING, "b"], { active: "a" })

    closeToRight("a", s.deps)

    expect(s.calls).toEqual([`close:${PENDING}`, "close:b"])
    expect(s.open).toEqual(["a"])
  })
})
