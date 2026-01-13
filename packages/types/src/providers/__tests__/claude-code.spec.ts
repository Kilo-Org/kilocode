import { normalizeClaudeCodeModelId } from "../claude-code.js"

describe("normalizeClaudeCodeModelId", () => {
	test("should return valid model IDs unchanged", () => {
		expect(normalizeClaudeCodeModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5")
		expect(normalizeClaudeCodeModelId("claude-opus-4-5")).toBe("claude-opus-4-5")
		expect(normalizeClaudeCodeModelId("claude-haiku-4-5")).toBe("claude-haiku-4-5")
	})

	test("should normalize sonnet models with date suffix to claude-sonnet-4-5", () => {
		// Sonnet 4.5 with date
		expect(normalizeClaudeCodeModelId("claude-sonnet-4-5-20250929")).toBe("claude-sonnet-4-5")
		// Sonnet 4 (legacy)
		expect(normalizeClaudeCodeModelId("claude-sonnet-4-20250514")).toBe("claude-sonnet-4-5")
		// Claude 3.7 Sonnet
		expect(normalizeClaudeCodeModelId("claude-3-7-sonnet-20250219")).toBe("claude-sonnet-4-5")
		// Claude 3.5 Sonnet
		expect(normalizeClaudeCodeModelId("claude-3-5-sonnet-20241022")).toBe("claude-sonnet-4-5")
	})

	test("should normalize opus models with date suffix to claude-opus-4-5", () => {
		// Opus 4.5 with date
		expect(normalizeClaudeCodeModelId("claude-opus-4-5-20251101")).toBe("claude-opus-4-5")
		// Opus 4.1 (legacy)
		expect(normalizeClaudeCodeModelId("claude-opus-4-1-20250805")).toBe("claude-opus-4-5")
		// Opus 4 (legacy)
		expect(normalizeClaudeCodeModelId("claude-opus-4-20250514")).toBe("claude-opus-4-5")
	})

	test("should normalize haiku models with date suffix to claude-haiku-4-5", () => {
		// Haiku 4.5 with date
		expect(normalizeClaudeCodeModelId("claude-haiku-4-5-20251001")).toBe("claude-haiku-4-5")
		// Claude 3.5 Haiku
		expect(normalizeClaudeCodeModelId("claude-3-5-haiku-20241022")).toBe("claude-haiku-4-5")
	})

	test("should handle case-insensitive model family matching", () => {
		expect(normalizeClaudeCodeModelId("Claude-Sonnet-4-5-20250929")).toBe("claude-sonnet-4-5")
		expect(normalizeClaudeCodeModelId("CLAUDE-OPUS-4-5-20251101")).toBe("claude-opus-4-5")
	})

	test("should fallback to default for unrecognized models", () => {
		expect(normalizeClaudeCodeModelId("unknown-model")).toBe("claude-sonnet-4-5")
		expect(normalizeClaudeCodeModelId("gpt-4")).toBe("claude-sonnet-4-5")
	})
})
