import { describe, expect, test } from "bun:test"
import { closeOthers, closeToRight, type CloseOthersDeps } from "../webview-ui/src/utils/tab-close"

function deps(ids: readonly string[], pinned: readonly string[] = []) {
  const calls = {
    activated: [] as string[],
    deactivated: 0,
    closedTerminals: [] as string[],
    closedReviews: 0,
    selectedReviews: 0,
    selectedSessions: [] as Array<[string, boolean]>,
    closedSessions: [] as string[],
  }
  const value: CloseOthersDeps & { visibleTabId: () => string | undefined } = {
    REVIEW_TAB_ID: "review",
    tabIds: () => ids,
    visibleTabId: () => undefined,
    isPending: () => false,
    isPinned: (id) => pinned.includes(id),
    activateTerminal: (id) => calls.activated.push(id),
    deactivateTerminal: () => calls.deactivated++,
    closeTerminal: (id) => calls.closedTerminals.push(id),
    closeReview: () => calls.closedReviews++,
    selectReviewTab: () => calls.selectedReviews++,
    selectSessionTab: (id, pending) => calls.selectedSessions.push([id, pending]),
    sessionClose: (id) => calls.closedSessions.push(id),
  }
  return { calls, value }
}

describe("closeOthers", () => {
  test("keeps the target and closes the other tabs", () => {
    const { calls, value } = deps(["one", "two", "three"])
    closeOthers("two", value)
    expect(calls.selectedSessions).toEqual([["two", false]])
    expect(calls.closedSessions).toEqual(["one", "three"])
  })

  test("closes nothing when the target is not an open tab", () => {
    const { calls, value } = deps(["one", "two"])
    // A subagent tab, or a menu left open after its tab closed, must not wipe the unrelated strip.
    closeOthers("ses_subagent", value)
    expect(calls.selectedSessions).toEqual([])
    expect(calls.closedSessions).toEqual([])
    expect(calls.closedTerminals).toEqual([])
    expect(calls.closedReviews).toBe(0)
    expect(calls.deactivated).toBe(0)
  })

  test("keeps pinned tabs", () => {
    const { calls, value } = deps(["one", "two", "three"], ["one"])
    closeOthers("two", value)
    expect(calls.closedSessions).toEqual(["three"])
  })
})

describe("closeToRight", () => {
  test("closes only the tabs after the target", () => {
    const { calls, value } = deps(["one", "two", "three"])
    closeToRight("two", value)
    expect(calls.closedSessions).toEqual(["three"])
    expect(calls.selectedSessions).toEqual([])
  })

  test("closes nothing when the target is not an open tab", () => {
    const { calls, value } = deps(["one", "two"])
    closeToRight("ses_subagent", value)
    expect(calls.closedSessions).toEqual([])
  })
})
