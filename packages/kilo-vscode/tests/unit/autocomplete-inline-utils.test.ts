import { describe, it, expect } from "bun:test"
import {
  findMatchingSuggestion,
  applyFirstLineOnly,
  countLines,
  shouldShowOnlyFirstLine,
  getFirstLine,
  calcDebounceDelay,
} from "../../src/services/autocomplete/classic-auto-complete/inline-utils"
import type { FillInAtCursorSuggestion } from "../../src/services/autocomplete/types"

function makeSuggestion(prefix: string, text: string, suffix = ""): FillInAtCursorSuggestion {
  return { prefix, suffix, text }
}

describe("countLines", () => {
  it("returns 0 for empty string", () => {
    expect(countLines("")).toBe(0)
  })

  it("returns 1 for single line without newline", () => {
    expect(countLines("hello")).toBe(1)
  })

  it("returns 1 for single line with trailing newline", () => {
    expect(countLines("hello\n")).toBe(1)
  })

  it("returns 2 for two lines", () => {
    expect(countLines("line1\nline2")).toBe(2)
  })

  it("returns 2 for two lines with trailing newline", () => {
    expect(countLines("line1\nline2\n")).toBe(2)
  })

  it("handles CRLF line endings", () => {
    expect(countLines("a\r\nb\r\nc")).toBe(3)
  })

  it("handles CRLF with trailing newline", () => {
    expect(countLines("a\r\nb\r\n")).toBe(2)
  })
})

describe("getFirstLine", () => {
  it("returns the first line of multi-line text", () => {
    expect(getFirstLine("line1\nline2\nline3")).toBe("line1")
  })

  it("returns the full text when single line", () => {
    expect(getFirstLine("hello")).toBe("hello")
  })

  it("returns empty string for empty input", () => {
    expect(getFirstLine("")).toBe("")
  })

  it("handles CRLF line endings", () => {
    expect(getFirstLine("line1\r\nline2")).toBe("line1")
  })
})

describe("shouldShowOnlyFirstLine", () => {
  it("returns false when suggestion starts with newline", () => {
    expect(shouldShowOnlyFirstLine("const x = ", "\n  return x")).toBe(false)
  })

  it("returns true when cursor is mid-line with code", () => {
    expect(shouldShowOnlyFirstLine("function foo() { return ", "bar\nbaz")).toBe(true)
  })

  it("returns false when prefix last line has no word chars (empty line)", () => {
    expect(shouldShowOnlyFirstLine("code\n", "line1\nline2\nline3")).toBe(false)
  })

  it("returns false for 2-line suggestion at start of line", () => {
    expect(shouldShowOnlyFirstLine("  ", "line1\nline2")).toBe(false)
  })

  it("returns true for 3-line suggestion at start of line with word chars", () => {
    expect(shouldShowOnlyFirstLine("  code", "line1\nline2\nline3")).toBe(true)
  })

  it("returns false for empty prefix", () => {
    expect(shouldShowOnlyFirstLine("", "any text")).toBe(false)
  })
})

describe("findMatchingSuggestion", () => {
  it("returns null for empty history", () => {
    expect(findMatchingSuggestion("prefix", "suffix", [])).toBeNull()
  })

  it("returns exact match", () => {
    const hist = [makeSuggestion("hello ", "world")]
    const result = findMatchingSuggestion("hello ", "", hist)
    expect(result?.matchType).toBe("exact")
    expect(result?.text).toBe("world")
  })

  it("returns partial_typing match when user typed beginning of suggestion", () => {
    const hist = [makeSuggestion("he", "llo world")]
    const result = findMatchingSuggestion("hell", "", hist)
    expect(result?.matchType).toBe("partial_typing")
    expect(result?.text).toBe("o world")
  })

  it("returns backward_deletion match when user deleted chars", () => {
    const hist = [makeSuggestion("hello world", "more", "suffix")]
    const result = findMatchingSuggestion("hello", "suffix", hist)
    expect(result?.matchType).toBe("backward_deletion")
    expect(result?.text).toBe(" worldmore")
  })

  it("prefers most recent suggestion (searches from end)", () => {
    const hist = [makeSuggestion("prefix", "old suggestion"), makeSuggestion("prefix", "new suggestion")]
    const result = findMatchingSuggestion("prefix", "", hist)
    expect(result?.text).toBe("new suggestion")
  })

  it("returns null when no match found", () => {
    const hist = [makeSuggestion("different", "no match")]
    expect(findMatchingSuggestion("unrelated", "suffix", hist)).toBeNull()
  })

  it("does not match empty suggestion text for partial_typing", () => {
    const hist = [makeSuggestion("prefix", "")]
    const result = findMatchingSuggestion("prefix more", "", hist)
    expect(result).toBeNull()
  })
})

describe("applyFirstLineOnly", () => {
  it("returns null when input is null", () => {
    expect(applyFirstLineOnly(null, "prefix")).toBeNull()
  })

  it("returns empty result unchanged", () => {
    const hist = [makeSuggestion("p", "")]
    const result = findMatchingSuggestion("p", "", hist)!
    const applied = applyFirstLineOnly(result, "p")
    expect(applied?.text).toBe("")
  })

  it("truncates to first line when mid-line suggestion", () => {
    const hist = [makeSuggestion("function foo() { return ", "x\n  const y = 1\n}")]
    const result = findMatchingSuggestion("function foo() { return ", "", hist)!
    const applied = applyFirstLineOnly(result, "function foo() { return ")
    expect(applied?.text).toBe("x")
  })

  it("preserves full multi-line suggestion when starting with newline", () => {
    const hist = [makeSuggestion("foo", "\n  const x = 1\n  const y = 2")]
    const result = findMatchingSuggestion("foo", "", hist)!
    const applied = applyFirstLineOnly(result, "foo")
    expect(applied?.text).toBe("\n  const x = 1\n  const y = 2")
  })
})

describe("calcDebounceDelay", () => {
  it("returns MIN when history is empty", () => {
    expect(calcDebounceDelay([])).toBe(150)
  })

  it("returns average of latencies clamped to min", () => {
    expect(calcDebounceDelay([50, 50, 50])).toBe(150)
  })

  it("returns average of latencies in normal range", () => {
    expect(calcDebounceDelay([400, 400, 400])).toBe(400)
  })

  it("clamps to MAX for very high latencies", () => {
    expect(calcDebounceDelay([2000, 2000, 2000])).toBe(1000)
  })

  it("rounds to nearest integer", () => {
    const result = calcDebounceDelay([300, 301])
    expect(Number.isInteger(result)).toBe(true)
  })
})
