import { describe, expect, test } from "bun:test"
import { canSafelyResume, resumeDecision } from "../resume"
import { detectSessionStall, scanSessionStalls, suggestEscalation } from "../watchdog"
import { GENERIC_RETRY_POLICY } from "../types"

describe("foundation watchdog and resume", () => {
  test("detects stall only for active sessions past the idle window", () => {
    expect(
      detectSessionStall({
        status: "running",
        nowIso: "2026-08-16T12:20:00.000Z",
        lastProgressIso: "2026-08-16T12:00:00.000Z",
        stallAfterMs: 15 * 60 * 1000,
      }),
    ).toBe(true)

    expect(
      detectSessionStall({
        status: "idle",
        nowIso: "2026-08-16T12:20:00.000Z",
        lastProgressIso: "2026-08-16T12:00:00.000Z",
      }),
    ).toBe(false)
  })

  test("escalates with generic coordinator language", () => {
    expect(suggestEscalation(GENERIC_RETRY_POLICY.workerAttempts - 1)).toBe("retry")
    expect(suggestEscalation(GENERIC_RETRY_POLICY.workerAttempts)).toBe("debug")
    expect(suggestEscalation(GENERIC_RETRY_POLICY.workerAttempts + GENERIC_RETRY_POLICY.debugEscalation)).toBe(
      "coordinator",
    )
  })

  test("resumes only on a safe lifecycle boundary", () => {
    expect(canSafelyResume("paused")).toBe(true)
    expect(canSafelyResume("running")).toBe(false)
    expect(resumeDecision("running")).toBe("wait")
    expect(resumeDecision("failed")).toBe("fail")
  })

  test("scanSessionStalls returns only active sessions past the window", () => {
    const stalled = scanSessionStalls(
      [
        {
          sessionId: "busy-silent",
          activity: "running",
          lastProgressIso: "2026-08-16T12:00:00.000Z",
        },
        {
          sessionId: "idle",
          activity: "idle",
          lastProgressIso: "2026-08-16T12:00:00.000Z",
        },
      ],
      "2026-08-16T12:20:00.000Z",
      15 * 60 * 1000,
    )
    expect(stalled.map((item) => item.sessionId)).toEqual(["busy-silent"])
  })
})
