import { describe, expect, test } from "bun:test"
import { failed, formatRate, select, type SessionModelUsage } from "@/kilocode/plugins/model-usage"

const data = {
  totals: {
    steps: 0,
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  },
  models: [],
} satisfies SessionModelUsage

describe("TUI model usage", () => {
  test("rejects stale session results and computes the cache rate", () => {
    expect(select({ sessionID: "ses_old", data }, "ses_current")).toBeUndefined()
    expect(failed({ sessionID: "ses_old" }, "ses_current")).toBeFalse()
    expect(select({ sessionID: "ses_current", data }, "ses_current")).toBe(data)
    expect(failed({ sessionID: "ses_current" }, "ses_current")).toBeTrue()
    expect(formatRate({ input: 100, output: 0, reasoning: 0, cache: { read: 300, write: 100 } })).toBe("60.0%")
  })
})
