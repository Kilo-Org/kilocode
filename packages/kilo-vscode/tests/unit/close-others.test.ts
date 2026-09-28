import { describe, expect, it } from "bun:test"
import { closeOthers, type CloseOthersDeps } from "../../webview-ui/agent-manager/close-others"

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
  const remove = (id: string) => {
    const index = open.indexOf(id)
    if (index >= 0) open.splice(index, 1)
  }
  const deps: CloseOthersDeps = {
    REVIEW_TAB_ID: REVIEW,
    tabIds: () => [...open],
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
  return {
    deps,
    calls,
    open,
    visible: () => (reviewActive && open.includes(REVIEW) ? REVIEW : (termActive ?? session ?? pending)),
  }
}

describe("agent manager close others", () => {
  it("reveals an active session target before closing the other tabs", () => {
    const s = scene(["ses:a", "ses:b", TERM_1], { active: "ses:a" })

    closeOthers("ses:a", s.deps)

    expect(s.calls).toEqual(["deactivate", "select:ses:a:false", "sessionClose:ses:b", "closeTerminal:terminal:1"])
    expect(s.open).toEqual(["ses:a"])
    expect(s.visible()).toBe("ses:a")
  })

  it("reveals a non-active session target and keeps only it", () => {
    const s = scene(["ses:a", "ses:b", TERM_1], { active: "ses:a" })

    closeOthers("ses:b", s.deps)

    expect(s.calls[0]).toBe("deactivate")
    expect(s.open).toEqual(["ses:b"])
    expect(s.visible()).toBe("ses:b")
  })

  it("does not steal selection while closing the previously active tab", () => {
    const s = scene(["ses:a", "ses:b"], { active: "ses:a" })

    closeOthers("ses:b", s.deps)

    expect(s.calls.filter((call) => call.startsWith("select:"))).toEqual(["select:ses:b:false"])
    expect(s.visible()).toBe("ses:b")
  })

  it("activates a terminal target before closing the other tabs", () => {
    const s = scene(["ses:a", TERM_1, TERM_2], { active: "ses:a" })

    closeOthers(TERM_2, s.deps)

    expect(s.calls[0]).toBe(`activate:${TERM_2}`)
    expect(s.open).toEqual([TERM_2])
    expect(s.visible()).toBe(TERM_2)
  })

  it("closes an open review tab among the others", () => {
    const s = scene(["ses:a", REVIEW, TERM_1], { active: "ses:a" })

    closeOthers("ses:a", s.deps)

    expect(s.calls).toContain("closeReview")
    expect(s.open).toEqual(["ses:a"])
    expect(s.visible()).toBe("ses:a")
  })

  it("reveals a review target and never routes it through the session path", () => {
    const s = scene(["ses:a", REVIEW, TERM_1], { active: "ses:a" })

    closeOthers(REVIEW, s.deps)

    expect(s.calls).toEqual(["deactivate", "selectReview", "sessionClose:ses:a", "closeTerminal:terminal:1"])
    expect(s.open).toEqual([REVIEW])
    expect(s.visible()).toBe(REVIEW)
  })

  it("closes a pending draft among the others", () => {
    const s = scene(["ses:a", PENDING, TERM_1], { active: "ses:a" })

    closeOthers("ses:a", s.deps)

    expect(s.calls).toContain(`sessionClose:${PENDING}`)
    expect(s.open).toEqual(["ses:a"])
    expect(s.visible()).toBe("ses:a")
  })

  it("keeps a session target visible when a running script terminal stays open", () => {
    const s = scene(["ses:a", TERM_1], { active: "ses:a", term: TERM_1, keep: [TERM_1] })

    closeOthers("ses:a", s.deps)

    expect(s.calls[0]).toBe("deactivate")
    expect(s.open).toEqual(["ses:a", TERM_1])
    expect(s.visible()).toBe("ses:a")
  })

  it("keeps pinned tabs open when closing the others", () => {
    const s = scene(["ses:a", "ses:b", "ses:c"], { active: "ses:a", pins: ["ses:b"] })

    closeOthers("ses:a", s.deps)

    expect(s.calls).not.toContain("sessionClose:ses:b")
    expect(s.calls).toContain("sessionClose:ses:c")
    expect(s.open).toEqual(["ses:a", "ses:b"])
  })
})
