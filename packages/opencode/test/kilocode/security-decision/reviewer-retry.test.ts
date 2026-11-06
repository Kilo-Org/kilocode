// kilocode_change - new file
import { afterEach, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
import { SecurityDecisionRules as R } from "@/kilocode/security-decision/rules"

/**
 * A review is one question with one answer, and the deadline is the budget for asking it.
 *
 * Two things used to cost a whole review: a transport hiccup and a model that wrapped its verdict
 * in something unparseable. Neither is a security outcome — the first is the network and the second
 * is formatting — so both are worth another attempt inside the time already allotted. A *verdict*,
 * on the other hand, is terminal whichever way it went: retrying a `keep_ask` until it turns into an
 * `allow` is not reliability, it is shopping for an answer.
 *
 * The deadline is shared, never per attempt, and however many attempts happen the caller sees one
 * outcome.
 */

const request: SecurityReviewer.Request = {
  rule_id: "SEC.V1.DESTRUCTIVE_FS",
  action: { kind: "bash", operation: "delete", argv: ["rm", "build/out.js"], paths: [] },
  workspace: { cwd: "." },
  containment: { sandbox: "operational", network: "deny", destinations: [], escalated: false },
}

const run = (timeout = 400) =>
  Effect.runPromise(SecurityReviewer.review(R.result(R.DESTRUCTIVE_FS), request, { timeout }))

afterEach(() => SecurityReviewer.reset())

/** A binding that answers with the given script, one entry per attempt, and counts its calls. */
function scripted(...answers: Array<string | Error>) {
  const calls = { count: 0 }
  SecurityReviewer.bind(() => {
    const answer = answers[Math.min(calls.count, answers.length - 1)]!
    calls.count += 1
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer)
  })
  return calls
}

describe("what is worth asking again", () => {
  test("a transport failure is retried and the second answer stands", async () => {
    const calls = scripted(new Error("socket hang up"), '{"decision":"allow","reason_code":"ROUTINE_CLEANUP"}')
    const out = await run()
    expect(calls.count).toBe(2)
    expect(out.result.decision).toBe("allow")
    expect(out.outcome).toMatchObject({ state: "allow", reason_code: "ROUTINE_CLEANUP", attempts: 2 })
  })

  test("an unparseable answer is retried", async () => {
    const calls = scripted("I think this is fine, honestly", '{"decision":"allow","reason_code":"ROUTINE_CLEANUP"}')
    const out = await run()
    expect(calls.count).toBe(2)
    expect(out.result.decision).toBe("allow")
  })

  test("attempts are bounded even when every one of them fails", async () => {
    const calls = scripted("not json")
    const out = await run()
    expect(calls.count).toBeGreaterThan(1)
    expect(calls.count).toBeLessThanOrEqual(3)
    expect(out.result.decision).toBe("ask")
    expect(out.outcome).toMatchObject({ state: "keep_ask", reason_code: "INVALID_RESPONSE" })
  })
})

describe("what is terminal", () => {
  test("a valid keep_ask is the answer, not an attempt", async () => {
    const calls = scripted('{"decision":"keep_ask","reason_code":"UNCLEAR_SCOPE"}')
    const out = await run()
    expect(calls.count).toBe(1)
    expect(out.outcome).toMatchObject({ state: "keep_ask", reason_code: "UNCLEAR_SCOPE", attempts: 1 })
  })

  test("a valid allow is not asked twice either", async () => {
    const calls = scripted('{"decision":"allow","reason_code":"ROUTINE_CLEANUP"}')
    await run()
    expect(calls.count).toBe(1)
  })

  test("a deny is not a verdict this reviewer can give, and is not retried into one", async () => {
    const calls = scripted('{"decision":"deny","reason_code":"DANGEROUS"}')
    const out = await run()
    // Unparseable as a verdict, so it is retried like any malformed answer — never turned into a deny.
    expect(out.result.decision).toBe("ask")
    expect(calls.count).toBeLessThanOrEqual(3)
  })
})

describe("the deadline is the budget for the whole review", () => {
  test("a hanging model spends the deadline once, not once per attempt", async () => {
    SecurityReviewer.bind(() => new Promise<string>(() => {}))
    const started = Date.now()
    const out = await run(300)
    const elapsed = Date.now() - started
    expect(out.outcome.state).toBe("timeout")
    expect(out.result.decision).toBe("ask")
    // One deadline, not three. The margin is for scheduling, not for a second attempt.
    expect(elapsed).toBeLessThan(600)
  })

  test("retries stop when the deadline is spent rather than running to the attempt limit", async () => {
    let calls = 0
    SecurityReviewer.bind(() => {
      calls += 1
      return new Promise<string>((resolve) => setTimeout(() => resolve("not json"), 120))
    })
    const started = Date.now()
    const out = await run(200)
    const elapsed = Date.now() - started
    expect(out.result.decision).toBe("ask")
    expect(elapsed).toBeLessThan(500)
    expect(calls).toBeLessThanOrEqual(3)
  })

  test("one review reports one outcome however many attempts it took", async () => {
    scripted(new Error("boom"), new Error("boom"), '{"decision":"allow","reason_code":"OK"}')
    const out = await run()
    expect(Object.keys(out).sort()).toEqual(["outcome", "result"])
    expect(out.outcome.attempts).toBe(3)
  })
})

describe("a verdict does not have to be decorated to be a verdict", () => {
  test("a bare decision is accepted with a stable default reason", async () => {
    scripted('{"decision":"allow"}')
    const out = await run()
    expect(out.result.decision).toBe("allow")
    expect(out.outcome.reason_code).toBe("UNSPECIFIED")
  })

  test("a bare keep_ask is accepted too", async () => {
    const calls = scripted('{"decision":"keep_ask"}')
    const out = await run()
    expect(calls.count).toBe(1)
    expect(out.outcome).toMatchObject({ state: "keep_ask", reason_code: "UNSPECIFIED" })
  })

  test("a verdict wrapped in prose is still recovered", async () => {
    scripted('Sure — here you go:\n{"decision":"allow","reason_code":"ROUTINE_CLEANUP"}\nHope that helps.')
    const out = await run()
    expect(out.result.decision).toBe("allow")
  })

  test("a malformed reason code is not a reason to throw the verdict away", async () => {
    // The decision is the part that matters; a badly shaped label falls back to the default.
    scripted('{"decision":"allow","reason_code":"has spaces"}')
    const out = await run()
    expect(out.result.decision).toBe("allow")
    expect(out.outcome.reason_code).toBe("UNSPECIFIED")
  })

  test("a missing decision is still not a verdict", async () => {
    scripted('{"reason_code":"LOOKS_FINE"}')
    const out = await run()
    expect(out.result.decision).toBe("ask")
  })
})
