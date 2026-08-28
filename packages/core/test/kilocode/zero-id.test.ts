import { describe, expect, expectTypeOf, test } from "bun:test"
import { zeroID } from "@opencode-ai/core/kilocode/zero-id"

describe("zeroID", () => {
  test("accepts only string, number, and boolean parts", () => {
    expectTypeOf<Parameters<typeof zeroID>>().toEqualTypeOf<(string | number | boolean)[]>()
    expectTypeOf<ReturnType<typeof zeroID>>().toEqualTypeOf<string>()
  })

  test("matches template literals for short composite keys", () => {
    const values = ["", "a", "a\0b", "路径", "null", "undefined", 0, -0, -1, 0.5, NaN, Infinity, -Infinity, true, false]
    for (const first of values) {
      for (const second of values) {
        expect(zeroID(first, second)).toBe(`${first}\0${second}`)
        for (const third of values) {
          expect(zeroID(first, second, third)).toBe(`${first}\0${second}\0${third}`)
        }
      }
    }
  })

  test("matches array joins across arities and preserves empty parts", () => {
    const cases: Parameters<typeof zeroID>[] = [
      [],
      [""],
      [false],
      [0],
      ["", ""],
      ["", "", ""],
      ["", "", "", ""],
      ["prefix", "", 0, false, "suffix"],
      ["/repo", "", "ancestor", "file.ts", true, "modified", 3, 0, false, ""],
      ["\0", "a\0b", "", "路径", NaN, -0, -Infinity, true, false],
    ]
    for (const parts of cases) {
      const expected = parts.join("\0")
      expect(zeroID(...parts)).toBe(expected)
      expect(Buffer.from(zeroID(...parts))).toEqual(Buffer.from(expected))
    }
  })

  test("preserves namespace prefixes, suffixes, and nested keys", () => {
    expect(zeroID("project", "")).toBe("project\0")
    expect(zeroID("", "file.ts")).toBe("\0file.ts")
    expect(zeroID("error", "message")).toBe("error\0message")
    expect(zeroID(zeroID("project", "session"), "file.ts")).toBe("project\0session\0file.ts")
    expect(zeroID("ab", "c")).not.toBe(zeroID("a", "bc"))
    expect(zeroID("project", "session").startsWith(zeroID("project", ""))).toBe(true)
    expect(zeroID("project-other", "session").startsWith(zeroID("project", ""))).toBe(false)
  })

  test("supports explicit caller-specific nullish coercion", () => {
    for (const value of [null, undefined]) {
      expect(zeroID("scope", String(value))).toBe(`scope\0${value}`)
      expect(zeroID("scope", value ?? "")).toBe(["scope", value].join("\0"))
    }
  })
})
