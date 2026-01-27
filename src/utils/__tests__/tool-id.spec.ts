import { sanitizeToolUseId, truncateOpenAiCallId, sanitizeOpenAiCallId, OPENAI_CALL_ID_MAX_LENGTH } from "../tool-id"

describe("sanitizeToolUseId", () => {
	describe("valid IDs pass through unchanged", () => {
		it("should preserve alphanumeric IDs", () => {
			expect(sanitizeToolUseId("toolu_01AbC")).toBe("toolu_01AbC")
		})

		it("should preserve IDs with underscores", () => {
			expect(sanitizeToolUseId("tool_use_123")).toBe("tool_use_123")
		})

		it("should preserve IDs with hyphens", () => {
			expect(sanitizeToolUseId("tool-with-hyphens")).toBe("tool-with-hyphens")
		})

		it("should preserve mixed valid characters", () => {
			expect(sanitizeToolUseId("toolu_01AbC-xyz_789")).toBe("toolu_01AbC-xyz_789")
		})

		it("should handle empty string", () => {
			expect(sanitizeToolUseId("")).toBe("")
		})
	})

	describe("invalid characters get replaced with underscore", () => {
		it("should replace dots with underscores", () => {
			expect(sanitizeToolUseId("tool.with.dots")).toBe("tool_with_dots")
		})

		it("should replace colons with underscores", () => {
			expect(sanitizeToolUseId("tool:with:colons")).toBe("tool_with_colons")
		})

		it("should replace slashes with underscores", () => {
			expect(sanitizeToolUseId("tool/with/slashes")).toBe("tool_with_slashes")
		})

		it("should replace backslashes with underscores", () => {
			expect(sanitizeToolUseId("tool\\with\\backslashes")).toBe("tool_with_backslashes")
		})

		it("should replace spaces with underscores", () => {
			expect(sanitizeToolUseId("tool with spaces")).toBe("tool_with_spaces")
		})

		it("should replace multiple invalid characters", () => {
			expect(sanitizeToolUseId("mcp.server:tool/name")).toBe("mcp_server_tool_name")
		})
	})

	describe("real-world MCP tool use ID patterns", () => {
		it("should sanitize MCP server-prefixed IDs with dots", () => {
			// MCP tool names often include server names with dots
			expect(sanitizeToolUseId("toolu_mcp.linear.create_issue")).toBe("toolu_mcp_linear_create_issue")
		})

		it("should sanitize IDs with URL-like patterns", () => {
			expect(sanitizeToolUseId("toolu_https://api.example.com/tool")).toBe("toolu_https___api_example_com_tool")
		})

		it("should sanitize IDs with special characters from server names", () => {
			expect(sanitizeToolUseId("call_mcp--posthog--query-run")).toBe("call_mcp--posthog--query-run")
		})

		it("should preserve valid native tool call IDs", () => {
			// Standard Anthropic tool_use IDs
			expect(sanitizeToolUseId("toolu_01H2X3Y4Z5")).toBe("toolu_01H2X3Y4Z5")
		})
	})
})

describe("truncateOpenAiCallId", () => {
	describe("IDs within limit pass through unchanged", () => {
		it("should preserve short IDs", () => {
			expect(truncateOpenAiCallId("toolu_01AbC")).toBe("toolu_01AbC")
		})

		it("should preserve IDs exactly at the limit", () => {
			const id64Chars = "a".repeat(64)
			expect(truncateOpenAiCallId(id64Chars)).toBe(id64Chars)
		})

		it("should handle empty string", () => {
			expect(truncateOpenAiCallId("")).toBe("")
		})
	})

	describe("long IDs get truncated with hash suffix", () => {
		it("should truncate IDs longer than 64 characters", () => {
			const longId = "a".repeat(70) // 70 chars, exceeds 64 limit
			const result = truncateOpenAiCallId(longId)
			expect(result.length).toBe(64)
		})

		it("should produce consistent results for the same input", () => {
			const longId = "toolu_mcp--linear--create_issue_12345678-1234-1234-1234-123456789012"
			const result1 = truncateOpenAiCallId(longId)
			const result2 = truncateOpenAiCallId(longId)
			expect(result1).toBe(result2)
		})

		it("should produce different results for different inputs", () => {
			const longId1 = "a".repeat(70) + "_unique1"
			const longId2 = "a".repeat(70) + "_unique2"
			const result1 = truncateOpenAiCallId(longId1)
			const result2 = truncateOpenAiCallId(longId2)
			expect(result1).not.toBe(result2)
		})

		it("should preserve the prefix and add hash suffix", () => {
			const longId = "toolu_mcp--linear--create_issue_" + "x".repeat(50)
			const result = truncateOpenAiCallId(longId)
			// Should start with the prefix (first 55 chars)
			expect(result.startsWith("toolu_mcp--linear--create_issue_")).toBe(true)
			// Should contain a separator and hash
			expect(result).toContain("_")
		})

		it("should handle the exact reported issue length (69 chars)", () => {
			// The original error mentioned 69 characters
			const id69Chars = "toolu_mcp--posthog--query_run_" + "a".repeat(39) // total 69 chars
			expect(id69Chars.length).toBe(69)
			const result = truncateOpenAiCallId(id69Chars)
			expect(result.length).toBe(64)
		})
	})

	describe("custom max length", () => {
		it("should support custom max length", () => {
			const longId = "a".repeat(50)
			const result = truncateOpenAiCallId(longId, 32)
			expect(result.length).toBe(32)
		})

		it("should not truncate if within custom limit", () => {
			const id = "short_id"
			expect(truncateOpenAiCallId(id, 100)).toBe(id)
		})
	})
})

describe("sanitizeOpenAiCallId", () => {
	it("should sanitize characters and truncate if needed", () => {
		// ID with invalid chars and too long
		const longIdWithInvalidChars = "toolu_mcp.server:tool/name_" + "x".repeat(50)
		const result = sanitizeOpenAiCallId(longIdWithInvalidChars)
		// Should be within limit
		expect(result.length).toBeLessThanOrEqual(64)
		// Should not contain invalid characters
		expect(result).toMatch(/^[a-zA-Z0-9_-]+$/)
	})

	it("should only sanitize if length is within limit", () => {
		const shortIdWithInvalidChars = "tool.with.dots"
		const result = sanitizeOpenAiCallId(shortIdWithInvalidChars)
		expect(result).toBe("tool_with_dots")
	})

	it("should handle real-world MCP tool IDs", () => {
		// Real MCP tool ID that might exceed 64 chars
		const mcpToolId = "call_mcp--posthog--dashboard_create_12345678-1234-1234-1234-123456789012"
		const result = sanitizeOpenAiCallId(mcpToolId)
		expect(result.length).toBeLessThanOrEqual(64)
		expect(result).toMatch(/^[a-zA-Z0-9_-]+$/)
	})

	it("should preserve IDs that are already valid and within limit", () => {
		const validId = "toolu_01AbC-xyz_789"
		expect(sanitizeOpenAiCallId(validId)).toBe(validId)
	})
})

describe("OPENAI_CALL_ID_MAX_LENGTH constant", () => {
	it("should be 64", () => {
		expect(OPENAI_CALL_ID_MAX_LENGTH).toBe(64)
	})
})
