import { describe, expect, it } from "bun:test"
import {
  formatCompletedAt,
  formatDuration,
  messageDurationMs,
} from "../../webview-ui/src/utils/format-message-timestamp"

describe("formatDuration", () => {
  it("formats seconds under a minute", () => {
    expect(formatDuration(0)).toBe("0s")
    expect(formatDuration(43000)).toBe("43s")
    expect(formatDuration(59499)).toBe("59s")
  })

  it("formats minutes with optional remainder", () => {
    expect(formatDuration(60000)).toBe("1m")
    expect(formatDuration(90000)).toBe("1m 30s")
    expect(formatDuration(125000)).toBe("2m 5s")
  })
})

describe("messageDurationMs", () => {
  it("returns undefined without completed", () => {
    expect(messageDurationMs({ created: 1000 })).toBeUndefined()
  })

  it("clamps negative to zero", () => {
    expect(messageDurationMs({ created: 2000, completed: 1000 })).toBe(0)
  })

  it("subtracts created from completed", () => {
    expect(messageDurationMs({ created: 1000, completed: 44000 })).toBe(43000)
  })
})

describe("formatCompletedAt", () => {
  it("includes weekday date and time", () => {
    // 2026-08-03 13:53:58 local — use fixed ms via UTC components then format in en-US
    const ms = Date.UTC(2026, 7, 3, 5, 53, 58) // mid-day-ish depending on TZ; just check shape
    const text = formatCompletedAt(ms, "en-US")
    expect(text).toMatch(/^\w{3} \d{2}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/)
  })
})
