import { describe, expect, it } from "bun:test"
import { tracksElapsed } from "../../webview-ui/src/components/shared/working-indicator-utils"

describe("tracksElapsed", () => {
  it("tracks pending submissions before backend status arrives", () => {
    expect(tracksElapsed("idle", true, 1)).toBe(true)
  })

  it("tracks active backend statuses", () => {
    expect(tracksElapsed("busy", false, 1)).toBe(true)
    expect(tracksElapsed("retry", false, 1)).toBe(true)
    expect(tracksElapsed("offline", false, 1)).toBe(true)
  })

  it("stops for idle sessions and missing start times", () => {
    expect(tracksElapsed("idle", false, 1)).toBe(false)
    expect(tracksElapsed("busy", false, undefined)).toBe(false)
    expect(tracksElapsed("idle", true, undefined)).toBe(false)
  })
})
