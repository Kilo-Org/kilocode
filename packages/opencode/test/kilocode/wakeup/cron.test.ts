import { describe, expect, test } from "bun:test"
import { JITTER_MS, MIN_INTERVAL_MS, isExpression, jitter, next, validate } from "@/kilocode/wakeup/cron"

const minute = MIN_INTERVAL_MS

/** The local minute-of-hour for a series of consecutive fire times. */
function minutesOf(expr: string, start: number, count: number) {
  const out: number[] = []
  let at = start
  for (let i = 0; i < count; i++) {
    at = next(expr, at)
    out.push(new Date(at).getMinutes())
  }
  return out
}

describe("validate", () => {
  test("accepts every supported form", () => {
    for (const expr of [
      "* * * * *",
      "0 12 * * *",
      "*/15 0-23/2 1,15 1-12 0-7",
      "5 4 * * 0",
      "0 0 1 1 7",
      "10-20/2 3 4 5 6",
      "0 0 * * 1-5",
    ]) {
      expect(validate(expr)).toBeUndefined()
    }
  })

  test("rejects the wrong field count", () => {
    expect(validate("* * * *")).toMatch(/5 fields/)
    expect(validate("* * * * * *")).toMatch(/5 fields/)
  })

  test("rejects unknown tokens", () => {
    expect(validate("a * * * *")).toBeString()
    expect(validate("* * * * mon")).toBeString()
    expect(validate("1- * * * *")).toBeString()
  })

  test("rejects out-of-range values", () => {
    expect(validate("60 * * * *")).toMatch(/minute/)
    expect(validate("* 24 * * *")).toMatch(/hour/)
    expect(validate("* * 0 * *")).toMatch(/day-of-month/)
    expect(validate("* * * 13 *")).toMatch(/month/)
    expect(validate("* * * * 8")).toMatch(/day-of-week/)
  })

  test("rejects reversed ranges", () => {
    expect(validate("5-1 * * * *")).toMatch(/[Rr]eversed/)
  })

  test("rejects a zero step", () => {
    expect(validate("*/0 * * * *")).toMatch(/[Ss]tep 0/)
    expect(validate("5-25/0 * * * *")).toBeString()
  })
})

describe("next", () => {
  test("returns the next whole minute strictly after now", () => {
    const from = new Date(2026, 0, 1, 8, 30, 42, 500).getTime()
    const at = next("* * * * *", from)
    expect(at).toBeGreaterThan(from)
    expect(at % minute).toBe(0)
    expect(new Date(at).getSeconds()).toBe(0)
    expect(new Date(at).getMilliseconds()).toBe(0)
    expect(at - from).toBeLessThanOrEqual(MIN_INTERVAL_MS)
  })

  test("returns exactly one minute ahead when already on a minute", () => {
    const from = new Date(2026, 0, 1, 8, 30, 0, 0).getTime()
    expect(next("* * * * *", from)).toBe(from + MIN_INTERVAL_MS)
  })

  test("lands on a local noon within two days", () => {
    const from = new Date(2026, 0, 1, 8, 30, 0, 0).getTime()
    const at = next("0 12 * * *", from)
    const date = new Date(at)
    expect(date.getHours()).toBe(12)
    expect(date.getMinutes()).toBe(0)
    expect(date.getSeconds()).toBe(0)
    expect(at - from).toBeLessThanOrEqual(2 * 24 * 60 * minute)
    expect(at).toBeGreaterThan(from)
  })

  test("matches step forms", () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    expect(minutesOf("*/15 * * * *", start, 5)).toEqual([15, 30, 45, 0, 15])
  })

  test("matches list forms", () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    expect(minutesOf("0,30 * * * *", start, 3)).toEqual([30, 0, 30])
  })

  test("matches range forms", () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    expect(minutesOf("10-13 * * * *", start, 5)).toEqual([10, 11, 12, 13, 10])
  })

  test("matches step-in-range forms", () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    expect(minutesOf("5-25/10 * * * *", start, 4)).toEqual([5, 15, 25, 5])
  })

  test("treats 7 as Sunday", () => {
    const start = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    const at = next("0 0 * * 7", start)
    expect(new Date(at).getDay()).toBe(0)
  })

  test("combines day-of-month and day-of-week with OR", () => {
    // Monday Jan 5 comes before any day that is both the 1st and a Monday.
    const fromDow = new Date(2026, 0, 2, 12, 0, 0, 0).getTime()
    const monday = next("0 0 1 * 1", fromDow)
    expect(new Date(monday).getDay()).toBe(1)
    expect(new Date(monday).getDate()).toBe(5)

    // The 25th (a Sunday) matches on day-of-month alone, before the next Monday.
    const fromDom = new Date(2026, 0, 20, 12, 0, 0, 0).getTime()
    const day = next("0 0 25 * 1", fromDom)
    expect(new Date(day).getDate()).toBe(25)
    expect(new Date(day).getDay()).toBe(0)
  })

  test("resolves a leap-day schedule more than a year out", () => {
    // Feb 29 next falls in 2028, beyond the old 366-day window.
    const from = new Date(2026, 2, 1, 0, 0, 0, 0).getTime()
    expect(validate("0 0 29 2 *")).toBeUndefined()
    const at = next("0 0 29 2 *", from)
    const date = new Date(at)
    expect(date.getMonth()).toBe(1)
    expect(date.getDate()).toBe(29)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
    expect(at).toBeGreaterThan(from)
  })

  test("resolves the next leap day across a skipped century year", () => {
    // 2100 is not a leap year, so the next Feb 29 after 2097 is in 2104, about
    // seven years out: the walk must skip whole stretches of non-matching days.
    const from = new Date(2097, 2, 1, 0, 0, 0, 0).getTime()
    const at = next("0 0 29 2 *", from)
    const date = new Date(at)
    expect(date.getFullYear()).toBe(2104)
    expect(date.getMonth()).toBe(1)
    expect(date.getDate()).toBe(29)
    expect(date.getHours()).toBe(0)
    expect(date.getMinutes()).toBe(0)
  })

  test("searches a far-out schedule without scanning every minute", () => {
    // A schedule that never matches walks the whole horizon. Skipping whole
    // non-matching days keeps that to a few thousand steps instead of the
    // millions of minutes a linear scan would test (which blocked the event
    // loop for ~650 ms), so this must finish well under a second.
    const from = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    const start = performance.now()
    expect(() => next("0 0 30 2 *", from)).toThrow(/No match within/)
    expect(performance.now() - start).toBeLessThan(250)
  })

  test("throws on invalid expressions", () => {
    const from = new Date(2026, 0, 1, 0, 0, 0, 0).getTime()
    for (const expr of ["* * * *", "* * * * * *", "60 * * * *", "* * * 13 *", "*/0 * * * *", "5-1 * * * *"]) {
      expect(validate(expr)).toBeString()
      expect(() => next(expr, from)).toThrow(validate(expr)!)
    }
  })
})

describe("jitter", () => {
  test("is deterministic for an id", () => {
    expect(jitter("wku-abc")).toBe(jitter("wku-abc"))
    expect(jitter("wku-abc")).toBe(jitter("wku-abc"))
  })

  test("stays within [0, JITTER_MS)", () => {
    for (const id of ["a", "wku-1", "session/2", "the-quick-brown-fox", ""]) {
      const value = jitter(id)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(JITTER_MS)
    }
  })

  test("differs across sampled ids", () => {
    const ids = Array.from({ length: 24 }, (_, i) => `wku-${i}`)
    const values = new Set(ids.map(jitter))
    expect(values.size).toBeGreaterThan(1)
  })
})

describe("isExpression", () => {
  test("accepts five tokens and rejects four", () => {
    expect(isExpression("* * * * *")).toBe(true)
    expect(isExpression("  0 12 * * *  ")).toBe(true)
    expect(isExpression("0 12 * *")).toBe(false)
    expect(isExpression("")).toBe(false)
  })
})
