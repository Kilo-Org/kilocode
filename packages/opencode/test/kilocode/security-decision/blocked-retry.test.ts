// kilocode_change - new file
import { test, expect, describe, afterEach } from "bun:test"
import { Effect } from "effect"
import { KiloSecurityGate } from "@/kilocode/security-decision/gate"
import { SecurityContinuation } from "@/kilocode/security-decision/continuation"
import { SecurityBlocked } from "@/kilocode/security-decision/block"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import type { SecurityDecisionTypes as T } from "@/kilocode/security-decision/types"

/**
 * A second attempt at something the policy already stopped is not a fresh question.
 *
 * The reviewer's job is to judge one action on its own evidence, and it is given no memory of the
 * turn on purpose. That makes a retry the one case where the evidence it sees is misleading: the
 * action looks exactly as ordinary as it did the first time, while the fact that matters — a human
 * boundary was already reached and the model came back at it anyway — lives outside the request.
 *
 * So a call whose signature is already in this turn's blocked set stays a mandatory human ask,
 * whatever the confinement says. The signature is the continuation model's, not the command text:
 * the same tool call written with its arguments in another order is the same attempt.
 */

const previous = process.env["KILO_SECURITY_DECISION"]
afterEach(() => {
  if (previous === undefined) delete process.env["KILO_SECURITY_DECISION"]
  else process.env["KILO_SECURITY_DECISION"] = previous
  SecurityReviewer.reset()
})

const CONTAINED: T.Containment = { sandbox: "operational", network: "deny", destinations: [], escalated: false }

/** A reviewable ask: deleting an ordinary in-workspace file inside a proven sandbox. */
const request = {
  permission: "bash",
  patterns: ["rm -rf build"],
  metadata: {
    securityFacts: {
      complete: true,
      composed: false,
      executable: "rm",
      argv: ["rm", "-rf", "build"],
      classified: true,
      effects: [{ operation: "delete", path: "/repo/build" }],
    },
  },
  sessionID: "ses_blocked",
  resolved: [{ pattern: "rm -rf build", action: "allow" as const }],
  humanOnly: false,
  workspace: "/repo",
  config: { getGlobal: () => Effect.succeed({ permission: {} } as never) },
  containment: CONTAINED,
}

function run(input: Partial<Parameters<typeof KiloSecurityGate.evaluate>[0]> = {}) {
  process.env["KILO_SECURITY_DECISION"] = "1"
  return Effect.runPromise(KiloSecurityGate.evaluate({ ...request, ...input }))
}

function permissive() {
  const calls = { count: 0 }
  SecurityReviewer.bind(() => {
    calls.count += 1
    return Promise.resolve('{"decision":"allow","reason_code":"ROUTINE_BUILD_CLEANUP"}')
  })
  return calls
}

describe("a retry of a blocked call is not offered to a reviewer", () => {
  test("the same action is reviewable while nothing has blocked it", async () => {
    const calls = permissive()
    const out = await run()
    expect(out?.reviewable).toBe(true)
    expect(out?.decision).toBe("allow")
    expect(calls.count).toBe(1)
  })

  test("once blocked in this turn, the reviewer is never asked again", async () => {
    const calls = permissive()
    const out = await run({ blocked: true })
    expect(calls.count).toBe(0)
    expect(out?.decision).toBe("ask")
    expect(out?.reviewable).toBe(false)
  })

  test("confinement does not buy the retry back", async () => {
    const calls = permissive()
    const out = await run({ blocked: true, containment: CONTAINED })
    expect(calls.count).toBe(0)
    expect(out?.decision).toBe("ask")
  })

  test("the audit says the reviewer did not run", async () => {
    permissive()
    const out = await run({ blocked: true })
    expect(out?.audit.reviewer.state).toBe("not_run")
  })
})

describe("the retry is recognised by signature, not by command text", () => {
  const blocked = () => SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", {} as never)

  test("a blocked call reports itself blocked however its input is ordered", () => {
    const state = SecurityContinuation.state()
    SecurityContinuation.after(state, blocked(), {
      tool: "bash",
      input: { command: "rm -rf build", description: "clean" },
    })
    expect(SecurityContinuation.blocked(state, "bash", { description: "clean", command: "rm -rf build" })).toBe(true)
  })

  test("a genuinely different action is not treated as a retry", () => {
    const state = SecurityContinuation.state()
    SecurityContinuation.after(state, blocked(), { tool: "bash", input: { command: "rm -rf build" } })
    expect(SecurityContinuation.blocked(state, "bash", { command: "rm -rf dist" })).toBe(false)
  })
})
