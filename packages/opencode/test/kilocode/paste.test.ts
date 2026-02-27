import { describe, expect, test } from "bun:test"
import { Paste } from "../../src/kilocode/paste"

describe("Paste", () => {
  describe("lineCount", () => {
    test("single line", () => {
      expect(Paste.lineCount("hello world")).toBe(1)
    })

    test("multiple lines", () => {
      expect(Paste.lineCount("line1\nline2\nline3")).toBe(3)
    })

    test("trailing newline", () => {
      expect(Paste.lineCount("line1\nline2\n")).toBe(3)
    })
  })

  describe("shouldSummarize", () => {
    test("short single-line paste is NOT summarized", () => {
      expect(Paste.shouldSummarize("hello world")).toBe(false)
    })

    test("long single-line paste is NOT summarized", () => {
      // This is the key regression: a long single line should NOT be summarized
      // because showing "[Pasted ~1 lines]" is confusing and unhelpful
      const long = "x".repeat(200)
      expect(Paste.shouldSummarize(long)).toBe(false)
    })

    test("2-3 line paste is NOT summarized when short", () => {
      expect(Paste.shouldSummarize("line1\nline2\nline3")).toBe(false)
    })

    test("small multi-line paste (5 lines) is NOT summarized", () => {
      const text = Array.from({ length: 5 }, (_, i) => `line ${i + 1}`).join("\n")
      expect(Paste.shouldSummarize(text)).toBe(false)
    })

    test("9-line paste is NOT summarized", () => {
      const text = Array.from({ length: 9 }, (_, i) => `line ${i + 1}`).join("\n")
      expect(Paste.shouldSummarize(text)).toBe(false)
    })

    test("10-line paste IS summarized", () => {
      const text = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n")
      expect(Paste.shouldSummarize(text)).toBe(true)
    })

    test("large multi-line paste IS summarized", () => {
      const text = Array.from({ length: 50 }, (_, i) => `line ${i + 1}: ${"content ".repeat(10)}`).join("\n")
      expect(Paste.shouldSummarize(text)).toBe(true)
    })

    test("multi-line paste exceeding length threshold IS summarized", () => {
      // 3 lines but very long content (> 500 chars)
      const text = `${"a".repeat(200)}\n${"b".repeat(200)}\n${"c".repeat(200)}`
      expect(Paste.shouldSummarize(text)).toBe(true)
    })

    test("multi-line paste under length threshold is NOT summarized", () => {
      const text = "short line 1\nshort line 2\nshort line 3"
      expect(Paste.shouldSummarize(text)).toBe(false)
    })
  })

  describe("summary", () => {
    test("shows correct line count", () => {
      const text = Array.from({ length: 15 }, (_, i) => `line ${i + 1}`).join("\n")
      expect(Paste.summary(text)).toBe("[Pasted ~15 lines]")
    })
  })
})
