import { describe, expect, test } from "bun:test"
import { formatWindow, windowLabel, windowProgress } from "../webview-ui/src/utils/provider-usage"
import type { UsageWindowLike } from "../webview-ui/src/utils/provider-usage"

const window = (value: Partial<UsageWindowLike>): UsageWindowLike => ({
  state: "active",
  resource: "general",
  unit: "percent",
  orientation: "remaining_percent",
  ...value,
})

describe("provider usage presentation", () => {
  test("formats used and remaining orientations without provider branching", () => {
    expect(formatWindow(window({ remaining: 75, limit: 100 }))).toBe("75% remaining")
    expect(formatWindow(window({ orientation: "used_percent", used: 25, limit: 100 }))).toBe("25% used")
    expect(windowProgress(window({ remaining: 75, limit: 100 }))).toBe(25)
  })

  test("keeps known zero distinct from unknown and preserves contract states", () => {
    expect(formatWindow(window({ remaining: 0, limit: 100, state: "exhausted" }))).toBe("0% remaining")
    expect(formatWindow(window({ state: "exhausted" }))).toBe("Exhausted")
    expect(formatWindow(window({ state: "unknown" }))).toBe("Unknown")
    expect(formatWindow(window({ state: "unlimited" }))).toBe("Unlimited")
    expect(formatWindow(window({ state: "not_in_plan" }))).toBe("Not in plan")
  })

  test("composes window labels from structured periods instead of wire strings", () => {
    expect(windowLabel(window({ resource: "subscription", period: { unit: "month", value: 1 } }))).toBe("Monthly quota")
    expect(windowLabel(window({ resource: "subscription", period: { unit: "day", value: 3 } }))).toBe("3-day quota")
    expect(windowLabel(window({ period: { unit: "hour", value: 5 } }))).toBe("Shared · 5-hour quota")
    expect(windowLabel(window({ period: { unit: "week", value: 1 } }))).toBe("Shared · Weekly quota")
    expect(windowLabel(window({ resource: "image" }))).toBe("image · Quota")
  })

  test("serves managed and direct plan sources with one formatter", () => {
    expect(windowLabel(window({ resource: "subscription", period: { unit: "hour", value: 5 } }))).toBe("5-hour quota")
    expect(formatWindow(window({ resource: "Codex", orientation: "used_percent", used: 42 }))).toBe("42% used")
  })
})
