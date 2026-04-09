import { describe, it, expect } from "bun:test"
import { clean } from "../../src/kilocode/enhance-prompt"

describe("enhance-prompt", () => {
  describe("clean", () => {
    it("trims whitespace", () => {
      expect(clean("  hello world  ")).toBe("hello world")
    })

    it("strips code block markers", () => {
      expect(clean("```\nhello world\n```")).toBe("hello world")
    })

    it("strips code block with language tag", () => {
      expect(clean("```text\nhello world\n```")).toBe("hello world")
    })

    it("strips surrounding double quotes", () => {
      expect(clean('"hello world"')).toBe("hello world")
    })

    it("strips surrounding single quotes", () => {
      expect(clean("'hello world'")).toBe("hello world")
    })

    it("strips code blocks and quotes together", () => {
      expect(clean('```\n"hello world"\n```')).toBe("hello world")
    })

    it("returns plain text unchanged", () => {
      expect(clean("hello world")).toBe("hello world")
    })

    it("handles empty string", () => {
      expect(clean("")).toBe("")
    })

    it("handles whitespace-only string", () => {
      expect(clean("   ")).toBe("")
    })

    it("does not strip internal quotes", () => {
      expect(clean('say "hello" to the world')).toBe('say "hello" to the world')
    })

    it("does not strip mismatched quotes", () => {
      expect(clean("\"hello world'")).toBe("\"hello world'")
    })
  })
})
