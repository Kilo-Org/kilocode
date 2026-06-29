import { describe, expect, test } from "bun:test"
import { MaxCostNudge } from "../../../src/kilocode/cost/max-cost-nudge"

const sid = "ses_1"

function assistant(id: string, cost: number, sessionID = sid) {
  return { id, sessionID, role: "assistant", cost }
}

describe("MaxCostNudge.normalizeLimit", () => {
  test("disables unset and non-positive values", () => {
    expect(MaxCostNudge.normalizeLimit(undefined)).toBeUndefined()
    expect(MaxCostNudge.normalizeLimit(null)).toBeUndefined()
    expect(MaxCostNudge.normalizeLimit(0)).toBeUndefined()
    expect(MaxCostNudge.normalizeLimit(-1)).toBeUndefined()
    expect(MaxCostNudge.normalizeLimit(Number.NaN)).toBeUndefined()
  })

  test("rounds positive values up to whole dollars", () => {
    expect(MaxCostNudge.normalizeLimit(5)).toBe(5)
    expect(MaxCostNudge.normalizeLimit(4.2)).toBe(5)
    expect(MaxCostNudge.normalizeLimit(0.01)).toBe(1)
  })
})

describe("MaxCostNudge.formatCost", () => {
  test("uses extra precision below one dollar", () => {
    expect(MaxCostNudge.formatCost(0.5)).toBe("$0.5000")
    expect(MaxCostNudge.formatCost(0.0001)).toBe("$0.0001")
    expect(MaxCostNudge.formatCost(1.5)).toBe("$1.50")
    expect(MaxCostNudge.formatCost(12)).toBe("$12.00")
  })
})

describe("MaxCostNudge cost aggregation", () => {
  test("sums assistant costs for the requested session", () => {
    const nudge = new MaxCostNudge()
    const total = nudge.resetMessageCosts(sid, [
      assistant("a1", 1),
      { id: "u1", sessionID: sid, role: "user" },
      assistant("a2", 2.5),
      assistant("a3", 9, "ses_2"),
    ])

    expect(total).toBe(3.5)
    expect(nudge.sessionCost(sid)).toBe(3.5)
    expect(nudge.sessionCost("ses_2")).toBe(0)
  })

  test("replaces existing message cost instead of double counting", () => {
    const nudge = new MaxCostNudge()
    nudge.resetMessageCosts(sid, [assistant("a1", 1)])

    expect(nudge.updateMessageCost(sid, "a1", "assistant", 4)).toBe(4)
    expect(nudge.updateMessageCost(sid, "a2", "assistant", 1)).toBe(5)
    expect(nudge.sessionCost(sid)).toBe(5)
  })

  test("reset replaces stale message costs for the session", () => {
    const nudge = new MaxCostNudge()
    nudge.resetMessageCosts(sid, [assistant("a1", 4), assistant("a2", 3)])
    nudge.resetMessageCosts(sid, [assistant("a2", 1)])

    expect(nudge.sessionCost(sid)).toBe(1)
  })

  test("removes a message contribution", () => {
    const nudge = new MaxCostNudge()
    nudge.resetMessageCosts(sid, [assistant("a1", 2), assistant("a2", 3)])
    nudge.removeMessageCost("a1")

    expect(nudge.sessionCost(sid)).toBe(3)
  })
})

describe("MaxCostNudge alerts", () => {
  test("alerts once when the session crosses the limit", () => {
    const nudge = new MaxCostNudge()
    nudge.setLimit(5)

    nudge.updateMessageCost(sid, "a1", "assistant", 4.99)
    expect(nudge.check(sid)).toBeUndefined()

    nudge.updateMessageCost(sid, "a2", "assistant", 0.01)
    expect(nudge.check(sid)).toEqual({ limit: 5, cost: 5 })
    expect(nudge.check(sid)).toBeUndefined()
  })

  test("never alerts without a configured limit", () => {
    const nudge = new MaxCostNudge()
    nudge.updateMessageCost(sid, "a1", "assistant", 999)

    expect(nudge.check(sid)).toBeUndefined()
  })

  test("continue suppresses re-alerts until the limit changes", () => {
    const nudge = new MaxCostNudge()
    nudge.setLimit(5)
    nudge.updateMessageCost(sid, "a1", "assistant", 6)

    expect(nudge.check(sid)?.cost).toBe(6)
    nudge.resolve(sid, "continue")

    nudge.rearm(sid)
    expect(nudge.check(sid)).toBeUndefined()

    nudge.setLimit(10)
    nudge.updateMessageCost(sid, "a2", "assistant", 5)
    expect(nudge.check(sid)).toEqual({ limit: 10, cost: 11 })
  })

  test("rearm re-alerts after a stop and a new run", () => {
    const nudge = new MaxCostNudge()
    nudge.setLimit(5)
    nudge.updateMessageCost(sid, "a1", "assistant", 7)

    expect(nudge.check(sid)?.cost).toBe(7)
    nudge.resolve(sid, "stop")
    expect(nudge.check(sid)).toBeUndefined()

    nudge.rearm(sid)
    nudge.updateMessageCost(sid, "a2", "assistant", 1)
    expect(nudge.check(sid)).toEqual({ limit: 5, cost: 8 })
  })
})

describe("MaxCostNudge.onSessionDeleted", () => {
  test("clears cost and alert state", () => {
    const nudge = new MaxCostNudge()
    nudge.setLimit(5)
    nudge.resetMessageCosts(sid, [assistant("a1", 9)])
    nudge.check(sid)

    nudge.onSessionDeleted(sid)
    expect(nudge.sessionCost(sid)).toBe(0)

    // A reused session id starts fresh and can alert again.
    nudge.updateMessageCost(sid, "a2", "assistant", 6)
    expect(nudge.check(sid)).toEqual({ limit: 5, cost: 6 })
  })
})
