import { describe, expect, test } from "bun:test"
import { Option } from "effect"
import { clampNotice, decodeRecord, MAX_HORIZON_MS, MIN_DELAY_MS, relative, resolveTime } from "../src/wakeup/schema"

describe("wakeup time", () => {
  test("requires exactly one of when and delay", () => {
    expect(resolveTime({}, 1_000)).toEqual({
      error: { message: "Provide exactly one of when or delay", past: false },
    })
    expect(resolveTime({ delay: "1m", when: "2030-01-01T00:00:00Z" }, 1_000)).toEqual({
      error: { message: "Provide exactly one of when or delay", past: false },
    })
  })

  test("parses the relative span forms and rejects a past delay", () => {
    expect(resolveTime({ delay: "5m" }, 1_000)).toEqual({ dueAt: 301_000 })
    expect(resolveTime({ delay: "30" }, 1_000)).toEqual({ dueAt: 31_000 })
    expect(resolveTime({ delay: "2h" }, 1_000)).toEqual({ dueAt: 7_201_000 })
    expect(resolveTime({ delay: "0s" }, 1_000)).toEqual({
      error: { message: "Wakeup delay is not in the future: 0s", past: true },
    })
    expect(resolveTime({ delay: "soon" }, 1_000)).toEqual({
      error: { message: "Invalid delay: soon", past: false },
    })
  })

  test("clamps a short delay up and a far time back", () => {
    expect(resolveTime({ delay: "5s" }, 1_000)).toEqual({ dueAt: 1_000 + MIN_DELAY_MS })
    expect(resolveTime({ delay: "30d" }, 1_000)).toEqual({ dueAt: 1_000 + MAX_HORIZON_MS })
  })

  test("rejects an absolute time that is not in the future", () => {
    expect(resolveTime({ when: "2026-09-13T14:30:00Z" }, Date.parse("2026-09-14T00:00:00Z"))).toEqual({
      error: { message: "Wakeup time is not in the future: 2026-09-13T14:30:00Z", past: true },
    })
  })

  test("reports only the clamps that applied", () => {
    const now = 1_000
    expect(clampNotice({ delay: "5s" }, now + MIN_DELAY_MS, now)).toContain("10-second minimum")
    expect(clampNotice({ delay: "30d" }, now + MAX_HORIZON_MS, now)).toContain("7-day horizon")
    expect(clampNotice({ delay: "5m" }, now + 300_000, now)).toBeUndefined()
  })
})

describe("wakeup record", () => {
  test("decodes a stored record and rejects a foreign value", () => {
    expect(
      Option.isSome(
        decodeRecord({
          id: "wku_1",
          scheduleID: "sch_1",
          kind: "wakeup",
          sessionID: "ses_1",
          directory: "/workspace",
          prompt: "check",
          created: 1,
          dueAt: 2,
        }),
      ),
    ).toBe(true)
    expect(Option.isNone(decodeRecord({ id: "wku_1" }))).toBe(true)
  })
})
