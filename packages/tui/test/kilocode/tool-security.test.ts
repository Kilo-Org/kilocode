import { describe, expect, test } from "bun:test"
import { describeSecurity } from "../../src/kilocode/tool-approval"

/**
 * The security layer's state, as the one-word note the TUI appends to a tool row.
 *
 * The terminal has no tooltip, so unlike the web badge this carries the state and nothing else —
 * `rule_id`, the reviewer's reason code and its latency have nowhere to hide here, and a header
 * line is not the place to spend three more columns on them.
 */

const record = (reviewer: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  securityDecision: { rule_id: "SEC.V1.UNCLASSIFIED_EXEC", reviewer, ...extra },
})

describe("describeSecurity", () => {
  test("a reviewer still deciding reads as reviewing", () => {
    expect(describeSecurity(record({ state: "running" }, { final_enforcement: "ask_pending" }))).toBe("reviewing")
  })

  test("a reviewer allow reads as auto-approved", () => {
    expect(describeSecurity(record({ state: "allow" }, { final_enforcement: "allow" }))).toBe("auto-approved")
  })

  test("a verdict that leaves the ask open reads as needing a human", () => {
    expect(describeSecurity(record({ state: "keep_ask" }, { final_enforcement: "ask_pending" }))).toBe("needs approval")
    expect(describeSecurity(record({ state: "timeout" }, { final_enforcement: "ask_pending" }))).toBe("needs approval")
  })

  test("a call that did not run reads as blocked", () => {
    expect(describeSecurity(record({ state: "not_run" }, { final_enforcement: "blocked" }))).toBe("blocked")
    expect(describeSecurity(record({ state: "not_run" }, { decision: "deny" }))).toBe("blocked")
  })

  test("an ordinary allowed call gets no note at all", () => {
    expect(describeSecurity(record({ state: "not_run" }, { final_enforcement: "allow" }))).toBeUndefined()
    expect(describeSecurity(undefined)).toBeUndefined()
    expect(describeSecurity({ approval: { source: "agent" } })).toBeUndefined()
  })
})
