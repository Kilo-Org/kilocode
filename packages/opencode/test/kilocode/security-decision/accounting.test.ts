// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import type { SecurityDecisionTypes as T } from "@/kilocode/security-decision/types"

/**
 * What one decision has to be able to say about itself afterwards.
 *
 * The layer already recorded what it decided. What it did not record is enough to tell *why* the
 * autonomy came out where it did: whether a reviewer was even asked, whether the request had to be
 * shortened first, which model answered, how many attempts it took, and whether the reviewer's
 * answer or the pipeline's enforcement had the last word. Without those, a run of asks and a run of
 * allows look the same from the outside, and there is no way to tell a strict policy from a broken
 * binding.
 */

const CONTAINMENT: T.Containment = { sandbox: "operational", network: "deny", destinations: [], escalated: false }

const context: SecurityDecisionAdapter.Context = {
  workspace: "/repo",
  effective: "allow",
  humanOnly: false,
  floor: { action: "allow", authority: "untrusted", conflict: false },
  containment: CONTAINMENT,
}

const shell = (argv: string[], effects: Array<{ operation: string; path?: string }>) =>
  SecurityDecisionAdapter.evaluate(
    {
      permission: "bash",
      patterns: [argv.join(" ")],
      metadata: {
        securityFacts: { complete: true, composed: false, executable: argv[0], argv, classified: true, effects },
      },
      sessionID: "ses_accounting",
    },
    context,
  )

afterEach(() => SecurityReviewer.reset())

describe("the audit says whether the reviewer could have run at all", () => {
  test("an unbound reviewer is named as unbound, with its reason", () => {
    SecurityReviewer.reset("flag_off")
    const out = shell(["rm", "-rf", "build"], [{ operation: "delete", path: "/repo/build" }])
    expect(out.audit.reviewer_binding).toBe("flag_off")
    expect(out.audit.reviewer_model).toBeUndefined()
  })

  test("a bound reviewer names the model the trusted binding chose", () => {
    SecurityReviewer.bind(() => Promise.resolve('{"decision":"keep_ask"}'), 200, "anthropic/claude-haiku-4-5")
    const out = shell(["rm", "-rf", "build"], [{ operation: "delete", path: "/repo/build" }])
    expect(out.audit.reviewer_binding).toBe("bound")
    expect(out.audit.reviewer_model).toBe("anthropic/claude-haiku-4-5")
  })
})

describe("the audit says whether the request had to be shortened", () => {
  test("an ordinary action reports no shortening", () => {
    const out = shell(["rm", "-rf", "build"], [{ operation: "delete", path: "/repo/build" }])
    expect(out.audit.reviewer_truncated).toBe(false)
  })

  test("an action that could not fit reports it separately from a metadata gap", () => {
    const argv = ["rm", ...Array.from({ length: 400 }, (_, index) => `argument-${index}`.padEnd(200, "x"))]
    const out = shell(argv, [{ operation: "delete", path: "/repo/build" }])
    expect(out.audit.reviewer_truncated).toBe(true)
    expect(out.rule_id).toBe("SEC.V1.METADATA_INCOMPLETE")
  })
})

describe("a finalized record carries a terminal status", () => {
  const record = (reviewer: SecurityReviewer.Outcome) =>
    SecurityDecisionAdapter.finalize(
      { ...shell(["rm", "-rf", "build"], [{ operation: "delete", path: "/repo/build" }]).audit, reviewer },
      "ask_pending",
      "security",
    )

  test.each([
    ["not_run", "not_reviewed"],
    ["running", "in_progress"],
    ["allow", "narrowed"],
    ["keep_ask", "held"],
    ["timeout", "timed_out"],
    ["error", "failed_closed"],
  ] as const)("reviewer state %s becomes %s", (state, expected) => {
    expect(record({ state }).terminal_status).toBe(expected)
  })

  test("the enforcement and its source are still recorded alongside", () => {
    const out = record({ state: "allow", reason_code: "ROUTINE", latency_ms: 12, attempts: 2 })
    expect(out.final_enforcement).toBe("ask_pending")
    expect(out.enforcement_source).toBe("security")
    expect(out.reviewer).toMatchObject({ state: "allow", latency_ms: 12, attempts: 2 })
  })
})
