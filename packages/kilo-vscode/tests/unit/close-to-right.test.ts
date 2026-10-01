import { describe, expect, it } from "bun:test"
import { closableRightOf, closeToRight, type CloseToRightDeps } from "../../webview-ui/agent-manager/close-to-right"

const REVIEW = "review"
const TERM_1 = "terminal:1"
const TERM_2 = "terminal:2"
const PENDING = "sidebar-pending:1"
const isPending = (id: string) => id.startsWith("sidebar-pending:")

/**
 * Fake tab bar that mirrors AgentManagerApp: `selectSessionTab` does not clear
 * the active terminal (the app relies on `deactivateTerminal` for that), and a
 * script terminal survives `closeTerminal` until the host confirms closure.
 */
function scene(ids: string[], opts: { active?: string; term?: string; keep?: string[]; pins?: string[] } = {}) {
  const open = [...ids]
  const calls: string[] = []
  const keep = new Set(opts.keep ?? [])
  const pins = new Set(opts.pins ?? [])
  let termActive = opts.term
  let session = opts.active
  let pending: string | undefined
  let reviewActive = false
  const visible = () => (reviewActive && open.includes(REVIEW) ? REVIEW : (termActive ?? session ?? pending))
  const remove = (id: string) => {
    const index = open.indexOf(id)
    if (index >= 0) open.splice(index, 1)
  }
  const deps: CloseToRightDeps = {
    REVIEW_TAB_ID: REVIEW,
    tabIds: () => [...open],
    visibleTabId: visible,
    isPending,
    isPinned: (id) => pins.has(id),
    activateTerminal: (id) => {
      calls.push(`activate:${id}`)
      termActive = id
      reviewActive = false
    },
    deactivateTerminal: () => {
      calls.push("deactivate")
      termActive = undefined
    },
    closeTerminal: (id) => {
      calls.push(`closeTerminal:${id}`)
      if (keep.has(id)) return
      remove(id)
      if (termActive === id) termActive = undefined
    },
    closeReview: () => {
      calls.push("closeReview")
      reviewActive = false
      remove(REVIEW)
    },
    selectReviewTab: () => {
      calls.push("selectReview")
      termActive = undefined
      session = undefined
      pending = undefined
      reviewActive = true
    },
    selectSessionTab: (id, isPendingTab) => {
      calls.push(`select:${id}:${isPendingTab}`)
      reviewActive = false
      if (isPendingTab) {
        pending = id
        session = undefined
        return
      }
      session = id
      pending = undefined
    },
    sessionClose: (id) => {
      calls.push(`sessionClose:${id}`)
      const wasActive = session === id
      const index = open.indexOf(id)
      remove(id)
      if (!wasActive) return
      // AgentManagerApp picks a neighbor when the active tab closes.
      const next = open[Math.min(index, open.length - 1)]
      if (!next) {
        session = undefined
        pending = undefined
        return
      }
      calls.push(`select:${next}:${isPending(next)}`)
      if (isPending(next)) {
        pending = next
        session = undefined
        return
      }
      session = next
      pending = undefined
    },
  }
  return { deps, calls, open, visible }
}

describe("agent manager close to right", () => {
  it("closes only the tabs after the target and leaves the visible tab alone", () => {
    const s = scene(["ses:a", "ses:b", "ses:c", "ses:d"], { active: "ses:a" })

    closeToRight("ses:b", s.deps)

    expect(s.calls).toEqual(["sessionClose:ses:c", "sessionClose:ses:d"])
    expect(s.open).toEqual(["ses:a", "ses:b"])
    expect(s.visible()).toBe("ses:a")
  })

  it("moves selection to the target only when the visible tab is closed", () => {
    const s = scene(["ses:a", "ses:b", "ses:c"], { active: "ses:c" })

    closeToRight("ses:b", s.deps)

    expect(s.calls).toEqual(["deactivate", "select:ses:b:false", "sessionClose:ses:c"])
    expect(s.open).toEqual(["ses:a", "ses:b"])
    expect(s.visible()).toBe("ses:b")
  })

  it("closes a visible terminal that sits to the right", () => {
    const s = scene(["ses:a", TERM_1, "ses:b"], { active: "ses:a", term: TERM_1 })

    closeToRight("ses:a", s.deps)

    expect(s.calls).toEqual(["deactivate", "select:ses:a:false", "closeTerminal:terminal:1", "sessionClose:ses:b"])
    expect(s.open).toEqual(["ses:a"])
    expect(s.visible()).toBe("ses:a")
  })

  it("closes an open review tab among the tabs to the right", () => {
    const s = scene(["ses:a", "ses:b", REVIEW, "ses:c"], { active: "ses:a" })

    closeToRight("ses:b", s.deps)

    expect(s.calls).toEqual(["closeReview", "sessionClose:ses:c"])
    expect(s.open).toEqual(["ses:a", "ses:b"])
    expect(s.visible()).toBe("ses:a")
  })

  it("keeps pinned tabs to the right open", () => {
    const s = scene(["ses:a", "ses:b", "ses:c", "ses:d"], { active: "ses:a", pins: ["ses:c"] })

    closeToRight("ses:b", s.deps)

    expect(s.calls).toEqual(["sessionClose:ses:d"])
    expect(s.open).toEqual(["ses:a", "ses:b", "ses:c"])
  })

  it("keeps selection on a pinned tab to the right that survives", () => {
    const s = scene(["pin:a", "pin:b", "ses:c"], { active: "pin:b", pins: ["pin:a", "pin:b"] })

    closeToRight("pin:a", s.deps)

    expect(s.calls).toEqual(["sessionClose:ses:c"])
    expect(s.open).toEqual(["pin:a", "pin:b"])
    expect(s.visible()).toBe("pin:b")
  })

  it("does nothing when the target is the last tab", () => {
    const s = scene(["ses:a", "ses:b"], { active: "ses:a" })

    closeToRight("ses:b", s.deps)

    expect(s.calls).toEqual([])
    expect(s.open).toEqual(["ses:a", "ses:b"])
    expect(s.visible()).toBe("ses:a")
  })

  it("does nothing when only pinned tabs remain to the right", () => {
    const s = scene(["pin:a", "pin:b"], { active: "pin:a", pins: ["pin:a", "pin:b"] })

    closeToRight("pin:a", s.deps)

    expect(s.calls).toEqual([])
    expect(s.open).toEqual(["pin:a", "pin:b"])
  })

  it("closes sessions after a terminal target without revealing it", () => {
    const s = scene(["ses:a", TERM_1, "ses:b"], { active: "ses:a" })

    closeToRight(TERM_1, s.deps)

    expect(s.calls).toEqual(["sessionClose:ses:b"])
    expect(s.open).toEqual(["ses:a", TERM_1])
    expect(s.visible()).toBe("ses:a")
  })

  it("keeps a session target visible when a running script terminal stays open", () => {
    const s = scene(["ses:a", "ses:b", TERM_1], { active: "ses:b", keep: [TERM_1] })

    closeToRight("ses:a", s.deps)

    expect(s.calls[0]).toBe("deactivate")
    expect(s.open).toEqual(["ses:a", TERM_1])
    expect(s.visible()).toBe("ses:a")
  })

  it("closes a pending draft that sits to the right", () => {
    const s = scene(["ses:a", PENDING, "ses:b"], { active: "ses:a" })

    closeToRight("ses:a", s.deps)

    expect(s.calls).toContain(`sessionClose:${PENDING}`)
    expect(s.open).toEqual(["ses:a"])
    expect(s.visible()).toBe("ses:a")
  })

  it("closes a terminal target with a pending draft to the right", () => {
    const s = scene([TERM_1, TERM_2, PENDING], { active: undefined, term: TERM_1 })

    closeToRight(TERM_1, s.deps)

    expect(s.calls).toEqual(["closeTerminal:terminal:2", `sessionClose:${PENDING}`])
    expect(s.open).toEqual([TERM_1])
    expect(s.visible()).toBe(TERM_1)
  })
})

describe("agent manager closable right", () => {
  const none = () => false
  const pins =
    (...ids: string[]) =>
    (id: string) =>
      ids.includes(id)

  it("returns every tab after the target in order", () => {
    expect(closableRightOf("b", ["a", "b", "c", "d"], REVIEW, none)).toEqual(["c", "d"])
  })

  it("returns nothing for the last tab", () => {
    expect(closableRightOf("d", ["a", "b", "c", "d"], REVIEW, none)).toEqual([])
  })

  it("returns nothing for an unknown target", () => {
    expect(closableRightOf("x", ["a", "b"], REVIEW, none)).toEqual([])
  })

  it("drops pinned session tabs but keeps terminals and the review tab", () => {
    expect(closableRightOf("a", ["a", "pin:b", TERM_1, REVIEW, "c"], REVIEW, pins("pin:b"))).toEqual([
      TERM_1,
      REVIEW,
      "c",
    ])
  })

  it("returns nothing when only pinned tabs are to the right", () => {
    expect(closableRightOf("a", ["a", "pin:b"], REVIEW, pins("pin:b"))).toEqual([])
  })
})
