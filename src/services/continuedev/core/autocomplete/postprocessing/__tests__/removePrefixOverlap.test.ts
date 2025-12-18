import { describe, it, expect } from "vitest"
import { removePrefixOverlap } from "../removePrefixOverlap.js"

describe("removePrefixOverlap", () => {
	it("should remove full prefix match", () => {
		expect(removePrefixOverlap("hello world", "hello ")).toBe("world")
	})

	it("should remove trimmed prefix when prefix has extra whitespace", () => {
		expect(removePrefixOverlap("hello world", "  hello  ")).toBe(" world")
	})

	it("should remove partial word overlap", () => {
		expect(removePrefixOverlap("hello world", "hel")).toBe("lo world")
	})

	it("should return completion as-is when no overlap", () => {
		expect(removePrefixOverlap("world", "hello")).toBe("world")
	})

	it("should use last line of multi-line prefix", () => {
		expect(removePrefixOverlap("hello world", "line 1\nline 2\nhello ")).toBe("world")
	})

	it("should handle empty strings", () => {
		expect(removePrefixOverlap("hello world", "")).toBe("hello world")
		expect(removePrefixOverlap("", "hello")).toBe("")
	})

	it("should be case-sensitive", () => {
		expect(removePrefixOverlap("hello world", "HELLO ")).toBe("hello world")
	})
})
