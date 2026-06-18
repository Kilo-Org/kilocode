import { describe, expect, it } from "bun:test"
import { mergeDismissals, pruneDismissals } from "../../src/shared/notifications"

const remote = {
  id: "remote",
  title: "Remote notification",
  message: "Remote message",
}

describe("notification dismissals", () => {
  it("preserves dismissed built-in notifications during API reconciliation", () => {
    expect(pruneDismissals([remote], ["star-giveaway-june-2026"])).toEqual(["star-giveaway-june-2026"])
  })

  it("prunes stale API notification dismissals", () => {
    expect(pruneDismissals([remote], ["remote", "stale"])).toEqual(["remote"])
  })

  it("preserves dismissals when the API returns no notifications", () => {
    expect(pruneDismissals([], ["star-giveaway-june-2026", "remote"])).toEqual(["star-giveaway-june-2026", "remote"])
  })

  it("keeps local dismissals hidden when a stale response omits them", () => {
    expect(mergeDismissals([], new Set(["star-giveaway-june-2026"]))).toEqual(["star-giveaway-june-2026"])
  })
})
