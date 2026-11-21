// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { SecurityBlocked } from "@/kilocode/security-decision/block"
import type { SecurityDecisionAdapter } from "@/kilocode/security-decision/adapter"

/**
 * The two things a block can mean, and why the model must be able to tell them apart.
 *
 * A policy refusal is a decision: the boundary is where it is, and the useful next move is a
 * materially different, safer approach — or the user. Telling the model only "blocked" invites it
 * to look for a spelling that gets through, which is the behaviour the continuation breaker then
 * has to stop.
 *
 * A reviewer that timed out or failed is not a decision at all. Nothing was judged, so reading it
 * as "unsafe" is wrong in the other direction: the model should be able to try once more or ask.
 *
 * Neither message may carry anything the model wrote or anything about how the rule engine reached
 * its answer. Our own rule identifier and our own state enum are the whole of what goes out.
 */

const audit = (reviewer: Partial<SecurityDecisionAdapter.Audit["reviewer"]> = { state: "not_run" }) =>
  ({ reviewer }) as unknown as SecurityDecisionAdapter.Audit

describe("a policy refusal says the boundary is the answer", () => {
  const error = () => SecurityBlocked.of("SEC.V1.GIT_HOOK_WRITE", audit())

  test("names the rule and nothing else about the decision", () => {
    const message = error().message
    expect(message).toContain("SEC.V1.GIT_HOOK_WRITE")
    expect(message).not.toContain("hook")
    expect(message).not.toContain(".git")
  })

  test("forbids reaching the same outcome another way", () => {
    const message = error().message.toLowerCase()
    expect(message).toContain("same")
    expect(message).toMatch(/workaround|work around|around this|indirect/)
  })

  test("offers the two ways forward that are allowed", () => {
    const message = error().message.toLowerCase()
    expect(message).toContain("safer")
    expect(message).toContain("user")
  })

  test("a reviewer that answered keep_ask is still a policy refusal", () => {
    const message = SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", audit({ state: "keep_ask" })).message
    expect(message.toLowerCase()).toContain("safer")
  })
})

describe("a reviewer that never answered says so", () => {
  test("a timeout is reported as a timeout, not as a refusal", () => {
    const message = SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", audit({ state: "timeout" })).message.toLowerCase()
    expect(message).toContain("not mean")
    expect(message).not.toContain("safer")
  })

  test("a transport failure reads the same way", () => {
    const message = SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", audit({ state: "error" })).message.toLowerCase()
    expect(message).toContain("not mean")
  })

  test("the two cases do not produce the same text", () => {
    const denial = SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", audit({ state: "keep_ask" })).message
    const timeout = SecurityBlocked.of("SEC.V1.DESTRUCTIVE_FS", audit({ state: "timeout" })).message
    expect(denial).not.toBe(timeout)
  })
})

describe("nothing the model wrote comes back out", () => {
  test("a reason code from the reviewer never reaches the message", () => {
    const message = SecurityBlocked.of(
      "SEC.V1.DESTRUCTIVE_FS",
      audit({ state: "keep_ask", reason_code: "LOOKS_LIKE_EXFILTRATION" }),
    ).message
    expect(message).not.toContain("LOOKS_LIKE_EXFILTRATION")
  })

  test("an audit with no reviewer record still produces a policy message", () => {
    const message = SecurityBlocked.of("SEC.V1.HOST_CONTROL", {} as never).message
    expect(message).toContain("SEC.V1.HOST_CONTROL")
    expect(message.toLowerCase()).toContain("safer")
  })
})
