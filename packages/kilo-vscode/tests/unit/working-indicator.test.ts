import { describe, expect, it } from "bun:test"
import { tracksElapsed } from "../../webview-ui/src/components/shared/working-indicator-utils"

const timing = { active: 0, since: 1 }

describe("tracksElapsed", () => {
  it("tracks pending submissions before backend status arrives", () => {
    expect(tracksElapsed("idle", true, timing)).toBe(true)
  })

  it("tracks active backend statuses", () => {
    expect(tracksElapsed("busy", false, timing)).toBe(true)
    expect(tracksElapsed("retry", false, timing)).toBe(true)
    expect(tracksElapsed("offline", false, timing)).toBe(true)
  })

  it("tracks a paused (parked) turn with no running stretch", () => {
    expect(tracksElapsed("busy", false, { active: 5000 })).toBe(true)
  })

  it("stops for idle sessions and missing timing", () => {
    expect(tracksElapsed("idle", false, timing)).toBe(false)
    expect(tracksElapsed("busy", false, undefined)).toBe(false)
    expect(tracksElapsed("idle", true, undefined)).toBe(false)
  })
})
