import { describe, expect, it } from "bun:test"
import { active, hold } from "../../webview-ui/src/context/session-timing"

describe("session timing", () => {
  it("reports banked time plus the running stretch", () => {
    const timing = { active: 5000, since: 1000 }
    expect(active(timing, 4000)).toBe(8000)
  })

  it("reports only banked time while paused", () => {
    const timing = { active: 5000 }
    expect(active(timing, 4000)).toBe(5000)
  })

  it("banks the running stretch and clears since", () => {
    const timing = { active: 5000, since: 1000 }
    expect(hold(timing, 4000)).toEqual({ active: 8000 })
  })

  it("is a no-op when already paused", () => {
    const timing = { active: 5000 }
    expect(hold(timing, 4000)).toBe(timing)
  })

  it("never banks negative time from a clock that moved backwards", () => {
    const timing = { active: 5000, since: 9000 }
    expect(hold(timing, 4000)).toEqual({ active: 5000 })
    expect(active(timing, 4000)).toBe(5000)
  })

  it("accumulates across repeated hold/resume cycles", () => {
    let timing = { active: 0, since: 0 }
    timing = hold(timing, 1000) // +1000 -> banked 1000, paused
    timing = { ...timing, since: 2000 } // resume at t=2000
    timing = hold(timing, 2500) // +500 -> banked 1500, paused
    timing = { ...timing, since: 3000 } // resume at t=3000
    expect(active(timing, 3200)).toBe(1700)
  })
})
