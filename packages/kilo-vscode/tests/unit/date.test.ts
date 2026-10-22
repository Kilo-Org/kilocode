import { describe, it, expect } from "bun:test"
import { formatRelativeDate } from "../../webview-ui/src/utils/date"

function ago(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const MONTH = 30 * DAY

describe("formatRelativeDate", () => {
  it("returns 'just now' for future timestamps", () => {
    const future = new Date(Date.now() + 5000).toISOString()
    expect(formatRelativeDate(future)).toBe("just now")
  })

  it("returns 'just now' for 0 seconds ago", () => {
    expect(formatRelativeDate(new Date().toISOString())).toBe("just now")
  })

  it("returns 'just now' for 30 seconds ago", () => {
    expect(formatRelativeDate(ago(30 * SEC))).toBe("just now")
  })

  it("returns 'just now' for 59 seconds ago", () => {
    expect(formatRelativeDate(ago(59 * SEC))).toBe("just now")
  })

  it("returns '1 min ago' for exactly 1 minute ago", () => {
    expect(formatRelativeDate(ago(MIN))).toBe("1 min ago")
  })

  it("returns '5 min ago' for 5 minutes ago", () => {
    expect(formatRelativeDate(ago(5 * MIN))).toBe("5 min ago")
  })

  it("returns '59 min ago' for 59 minutes ago", () => {
    expect(formatRelativeDate(ago(59 * MIN))).toBe("59 min ago")
  })

  it("returns '1h ago' for exactly 1 hour ago", () => {
    expect(formatRelativeDate(ago(HOUR))).toBe("1h ago")
  })

  it("returns '12h ago' for 12 hours ago", () => {
    expect(formatRelativeDate(ago(12 * HOUR))).toBe("12h ago")
  })

  it("returns '23h ago' for 23 hours ago", () => {
    expect(formatRelativeDate(ago(23 * HOUR))).toBe("23h ago")
  })

  it("returns '1d ago' for exactly 1 day ago", () => {
    expect(formatRelativeDate(ago(DAY))).toBe("1d ago")
  })

  it("returns '7d ago' for 7 days ago", () => {
    expect(formatRelativeDate(ago(7 * DAY))).toBe("7d ago")
  })

  it("returns '29d ago' for 29 days ago", () => {
    expect(formatRelativeDate(ago(29 * DAY))).toBe("29d ago")
  })

  it("returns '1mo ago' for exactly 30 days ago", () => {
    expect(formatRelativeDate(ago(MONTH))).toBe("1mo ago")
  })

  it("returns '6mo ago' for 6 months ago", () => {
    expect(formatRelativeDate(ago(6 * MONTH))).toBe("6mo ago")
  })

  it("returns 'just now' for invalid ISO string (fallback to now)", () => {
    expect(formatRelativeDate("not-a-date")).toBe("just now")
  })

  it("returns 'just now' for empty string (fallback to now)", () => {
    expect(formatRelativeDate("")).toBe("just now")
  })
})
