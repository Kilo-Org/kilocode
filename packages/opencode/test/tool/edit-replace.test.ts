// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import {
  LineTrimmedReplacer,
  replace,
  TrimmedBoundaryReplacer,
  WhitespaceNormalizedReplacer,
} from "../../src/tool/edit"

describe("edit.replace literal text", () => {
  test("replaceAll keeps dollar patterns literal", () => {
    expect(replace("a", "a", "$$", true)).toBe("$$")
    expect(replace("ab", "a", "$&", true)).toBe("$&b")
    expect(replace("ab", "a", "$`", true)).toBe("$`b")
    expect(replace("ab", "b", "$'", true)).toBe("a$'")
    expect(replace("hello", "l", "$$", true)).toBe("he$$$$o")
    expect(replace("a", "a", "$$", false)).toBe("$$")
  })

  test("replaceAll whitespace-only miss stays not found", () => {
    expect(() => replace("abc", "  ", "X", true)).toThrow(/Could not find oldString/)
    expect(() => replace("a\n\nb", "  ", "X", true)).toThrow(/Could not find oldString/)
    expect(() => replace("hello", " \n ", "X", true)).toThrow(/Could not find oldString/)
    let message = ""
    try {
      replace("abc", "  ", "X", false)
    } catch (err) {
      message = err instanceof Error ? err.message : String(err)
    }
    expect(message).toContain("Could not find oldString")
    expect(message).not.toContain("Found multiple matches")
  })

  test("replaceAll still replaces an exact space run", () => {
    expect(replace("a  b", "  ", "X", true)).toBe("aXb")
  })

  test("fuzzy replacers do not yield an empty match for whitespace-only oldString", () => {
    expect([...TrimmedBoundaryReplacer("abc", "  ")]).not.toContain("")
    expect([...WhitespaceNormalizedReplacer("abc", "  ")]).not.toContain("")
    expect([...LineTrimmedReplacer("a\n\nb", "  ")]).not.toContain("")
  })
})
