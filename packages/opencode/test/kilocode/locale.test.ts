import { describe, expect, test } from "bun:test"
import { Locale } from "../../src/util/locale"

describe("util.locale", () => {
  const long = "src/components/very-long-file-name.tsx"

  describe("truncateLeft", () => {
    test("never returns more than maxLength characters", () => {
      for (const len of [1, 2, 3, 10, 20]) {
        expect(Locale.truncateLeft(long, len).length).toBeLessThanOrEqual(len)
      }
    })

    test("collapses to a single ellipsis at length 1", () => {
      // `slice(-0)` is `slice(0)`, which used to leak the whole string here.
      expect(Locale.truncateLeft(long, 1)).toBe("…")
    })

    test("keeps the tail characters", () => {
      expect(Locale.truncateLeft(long, 5)).toBe("….tsx")
    })

    test("returns short strings unchanged", () => {
      expect(Locale.truncateLeft("abc", 10)).toBe("abc")
    })
  })

  describe("truncateMiddle", () => {
    test("never returns more than maxLength characters", () => {
      for (const len of [1, 2, 3, 10, 20]) {
        expect(Locale.truncateMiddle(long, len).length).toBeLessThanOrEqual(len)
      }
    })

    test("collapses to a single ellipsis at length 1", () => {
      // keepEnd is 0 here, so `slice(-0)` used to append the whole string.
      expect(Locale.truncateMiddle(long, 1)).toBe("…")
    })

    test("drops the tail at length 2", () => {
      expect(Locale.truncateMiddle(long, 2)).toBe("s…")
    })

    test("keeps head and tail around the ellipsis", () => {
      const result = Locale.truncateMiddle(long, 11)
      expect(result.length).toBe(11)
      expect(result).toContain("…")
      expect(result.startsWith("src")).toBe(true)
      expect(result.endsWith("tsx")).toBe(true)
    })

    test("returns short strings unchanged", () => {
      expect(Locale.truncateMiddle("abc", 10)).toBe("abc")
    })
  })
})
