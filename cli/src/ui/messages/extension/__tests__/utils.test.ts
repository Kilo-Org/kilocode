import { describe, it, expect } from "vitest"
import {
	formatJson,
	formatContentWithMetadata,
	buildMetadataString,
	formatByteSize,
	isMcpServerData,
	parseMcpServerData,
	formatUnknownMessageContent,
} from "../utils.js"
import type { ExtensionChatMessage } from "../../../../types/messages.js"

describe("formatJson", () => {
	it("should format valid JSON with indentation", () => {
		const input = '{"key":"value","nested":{"data":123}}'
		const expected = JSON.stringify(JSON.parse(input), null, 2)
		expect(formatJson(input)).toBe(expected)
	})

	it("should use custom indentation", () => {
		const input = '{"key":"value"}'
		const expected = JSON.stringify(JSON.parse(input), null, 4)
		expect(formatJson(input, 4)).toBe(expected)
	})

	it("should return null for invalid JSON", () => {
		expect(formatJson("plain text")).toBe(null)
		expect(formatJson("{invalid}")).toBe(null)
		expect(formatJson("")).toBe(null)
	})

	it("should handle arrays", () => {
		const input = '["item1","item2"]'
		const expected = JSON.stringify(JSON.parse(input), null, 2)
		expect(formatJson(input)).toBe(expected)
	})
})

describe("formatContentWithMetadata", () => {
	it("should detect and format JSON content", () => {
		const json = '{"key":"value"}'
		const result = formatContentWithMetadata(json, 20, 5)

		expect(result.isJson).toBe(true)
		expect(result.content).toContain("key")
		expect(result.content).toContain("value")
		expect(result.isPreview).toBe(false)
	})

	it("should handle plain text content", () => {
		const text = "Plain text content"
		const result = formatContentWithMetadata(text, 20, 5)

		expect(result.isJson).toBe(false)
		expect(result.content).toBe(text)
		expect(result.lineCount).toBe(1)
		expect(result.isPreview).toBe(false)
	})

	it("should create preview for long content", () => {
		const lines = Array(30)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")
		const result = formatContentWithMetadata(lines, 20, 5)

		expect(result.isPreview).toBe(true)
		expect(result.hiddenLines).toBe(25) // 30 - 5 = 25
		expect(result.lineCount).toBe(30)
		expect(result.content).toContain("Line 1")
		expect(result.content).not.toContain("Line 30")
	})

	it("should calculate metadata correctly", () => {
		const text = "Hello\nWorld"
		const result = formatContentWithMetadata(text, 20, 5)

		expect(result.lineCount).toBe(2)
		expect(result.charCount).toBe(11)
		expect(result.byteSize).toBeGreaterThan(0)
	})

	it("should handle empty string", () => {
		const result = formatContentWithMetadata("", 20, 5)

		expect(result.content).toBe("")
		expect(result.lineCount).toBe(0)
		expect(result.charCount).toBe(0)
		expect(result.byteSize).toBe(0)
		expect(result.isPreview).toBe(false)
	})

	it("should handle content at threshold boundary", () => {
		const lines = Array(20)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")
		const result = formatContentWithMetadata(lines, 20, 5)

		expect(result.isPreview).toBe(false)
		expect(result.lineCount).toBe(20)
	})

	it("should handle content just over threshold", () => {
		const lines = Array(21)
			.fill(null)
			.map((_, i) => `Line ${i + 1}`)
			.join("\n")
		const result = formatContentWithMetadata(lines, 20, 5)

		expect(result.isPreview).toBe(true)
		expect(result.hiddenLines).toBe(16) // 21 - 5 = 16
	})
})

describe("formatByteSize", () => {
	it("should format bytes", () => {
		expect(formatByteSize(100)).toBe("100 B")
		expect(formatByteSize(1023)).toBe("1023 B")
	})

	it("should format kilobytes with ~ prefix", () => {
		expect(formatByteSize(1024)).toBe("~1.0 KB")
		expect(formatByteSize(2048)).toBe("~2.0 KB")
		expect(formatByteSize(1536)).toBe("~1.5 KB")
	})

	it("should format megabytes with ~ prefix", () => {
		expect(formatByteSize(1024 * 1024)).toBe("~1.0 MB")
		expect(formatByteSize(2.5 * 1024 * 1024)).toBe("~2.5 MB")
		expect(formatByteSize(10 * 1024 * 1024)).toBe("~10.0 MB")
	})

	it("should round to one decimal place", () => {
		expect(formatByteSize(1536)).toBe("~1.5 KB")
		expect(formatByteSize(1587)).toBe("~1.5 KB") // Should round down
		expect(formatByteSize(1638)).toBe("~1.6 KB") // Should round up
	})
})

describe("buildMetadataString", () => {
	it("should build metadata for JSON content", () => {
		const metadata = {
			isJson: true,
			content: "{}",
			lineCount: 5,
			charCount: 100,
			byteSize: 100,
			isPreview: false,
			hiddenLines: 0,
		}

		const result = buildMetadataString(metadata)
		expect(result).toContain("JSON")
		expect(result).toContain("5 lines")
		expect(result).not.toContain("B") // Under 1KB
	})

	it("should build metadata for text content", () => {
		const metadata = {
			isJson: false,
			content: "text",
			lineCount: 1,
			charCount: 50,
			byteSize: 50,
			isPreview: false,
			hiddenLines: 0,
		}

		const result = buildMetadataString(metadata)
		expect(result).toContain("Text")
		expect(result).toContain("1 line")
		expect(result).not.toContain("lines") // Singular
	})

	it("should include byte size for large content", () => {
		const metadata = {
			isJson: false,
			content: "text",
			lineCount: 10,
			charCount: 5000,
			byteSize: 5000,
			isPreview: false,
			hiddenLines: 0,
		}

		const result = buildMetadataString(metadata)
		expect(result).toContain("10 lines")
		expect(result).toContain("KB")
	})

	it("should handle plural lines correctly", () => {
		const singleLine = {
			isJson: false,
			content: "text",
			lineCount: 1,
			charCount: 10,
			byteSize: 10,
			isPreview: false,
			hiddenLines: 0,
		}

		const multiLine = {
			isJson: false,
			content: "text",
			lineCount: 2,
			charCount: 20,
			byteSize: 20,
			isPreview: false,
			hiddenLines: 0,
		}

		expect(buildMetadataString(singleLine)).toContain("1 line")
		expect(buildMetadataString(multiLine)).toContain("2 lines")
	})

	it("should format complete metadata string correctly", () => {
		const metadata = {
			isJson: true,
			content: "{}",
			lineCount: 26,
			charCount: 11469,
			byteSize: 11469,
			isPreview: false,
			hiddenLines: 0,
		}

		const result = buildMetadataString(metadata)
		expect(result).toBe("JSON, 26 lines, ~11.2 KB")
	})
})

describe("isMcpServerData", () => {
	it("should validate valid MCP tool use data", () => {
		const valid = {
			type: "use_mcp_tool",
			serverName: "filesystem",
			toolName: "read_file",
			arguments: '{"path": "/test"}',
		}
		expect(isMcpServerData(valid)).toBe(true)
	})

	it("should validate valid MCP resource access data", () => {
		const valid = {
			type: "access_mcp_resource",
			serverName: "database",
			uri: "db://users",
		}
		expect(isMcpServerData(valid)).toBe(true)
	})

	it("should reject invalid type", () => {
		const invalid = {
			type: "invalid_type",
			serverName: "test",
		}
		expect(isMcpServerData(invalid)).toBe(false)
	})

	it("should reject missing serverName", () => {
		const invalid = {
			type: "use_mcp_tool",
			toolName: "test",
		}
		expect(isMcpServerData(invalid)).toBe(false)
	})

	it("should reject non-string serverName", () => {
		const invalid = {
			type: "use_mcp_tool",
			serverName: 123,
		}
		expect(isMcpServerData(invalid)).toBe(false)
	})

	it("should reject non-string toolName", () => {
		const invalid = {
			type: "use_mcp_tool",
			serverName: "test",
			toolName: 123,
		}
		expect(isMcpServerData(invalid)).toBe(false)
	})

	it("should reject non-string arguments", () => {
		const invalid = {
			type: "use_mcp_tool",
			serverName: "test",
			arguments: { key: "value" },
		}
		expect(isMcpServerData(invalid)).toBe(false)
	})

	it("should accept minimal valid data", () => {
		const valid = {
			type: "use_mcp_tool",
			serverName: "test",
		}
		expect(isMcpServerData(valid)).toBe(true)
	})

	it("should reject null or undefined", () => {
		expect(isMcpServerData(null)).toBe(false)
		expect(isMcpServerData(undefined)).toBe(false)
	})

	it("should reject non-object values", () => {
		expect(isMcpServerData("string")).toBe(false)
		expect(isMcpServerData(123)).toBe(false)
		expect(isMcpServerData(true)).toBe(false)
	})
})

describe("parseMcpServerData", () => {
	it("should parse valid MCP server data", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "use_mcp_server",
			text: JSON.stringify({
				type: "use_mcp_tool",
				serverName: "filesystem",
				toolName: "read_file",
			}),
			ts: Date.now(),
		}

		const result = parseMcpServerData(message)
		expect(result).toBeTruthy()
		expect(result?.type).toBe("use_mcp_tool")
		expect(result?.serverName).toBe("filesystem")
		expect(result?.toolName).toBe("read_file")
	})

	it("should return null for invalid data", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "use_mcp_server",
			text: JSON.stringify({
				type: "invalid",
				name: "test",
			}),
			ts: Date.now(),
		}

		const result = parseMcpServerData(message)
		expect(result).toBe(null)
	})

	it("should return null for non-JSON text", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "use_mcp_server",
			text: "plain text",
			ts: Date.now(),
		}

		const result = parseMcpServerData(message)
		expect(result).toBe(null)
	})

	it("should return null for empty text", () => {
		const message: ExtensionChatMessage = {
			type: "ask",
			ask: "use_mcp_server",
			text: "",
			ts: Date.now(),
		}

		const result = parseMcpServerData(message)
		expect(result).toBe(null)
	})
})

describe("formatUnknownMessageContent", () => {
	describe("fallback behavior", () => {
		it("should return fallback when text is undefined", () => {
			expect(formatUnknownMessageContent(undefined, "fallback message")).toBe("fallback message")
		})

		it("should return fallback when text is empty string", () => {
			expect(formatUnknownMessageContent("", "fallback message")).toBe("fallback message")
		})
	})

	describe("plain text handling", () => {
		it("should return plain text as-is", () => {
			expect(formatUnknownMessageContent("Hello world", "fallback")).toBe("Hello world")
		})

		it("should return text that doesn't start with { or [", () => {
			expect(formatUnknownMessageContent("Some message", "fallback")).toBe("Some message")
		})

		it("should handle text with leading whitespace that is not JSON", () => {
			expect(formatUnknownMessageContent("  plain text", "fallback")).toBe("  plain text")
		})
	})

	describe("JSON object formatting", () => {
		it("should format valid JSON object with pretty printing", () => {
			const input = '{"key":"value"}'
			const expected = JSON.stringify({ key: "value" }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should format nested JSON objects", () => {
			const input = '{"outer":{"inner":"value"}}'
			const expected = JSON.stringify({ outer: { inner: "value" } }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should format JSON with leading whitespace", () => {
			const input = '  {"key":"value"}'
			const expected = JSON.stringify({ key: "value" }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})
	})

	describe("JSON array formatting", () => {
		it("should format valid JSON array with pretty printing", () => {
			const input = '["item1","item2"]'
			const expected = JSON.stringify(["item1", "item2"], null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should format array of objects", () => {
			const input = '[{"id":1},{"id":2}]'
			const expected = JSON.stringify([{ id: 1 }, { id: 2 }], null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should format JSON array with leading whitespace", () => {
			const input = '  ["a","b"]'
			const expected = JSON.stringify(["a", "b"], null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})
	})

	describe("invalid JSON handling", () => {
		it("should return text as-is when JSON parsing fails for object-like text", () => {
			const input = "{invalid json}"
			expect(formatUnknownMessageContent(input, "fallback")).toBe(input)
		})

		it("should return text as-is when JSON parsing fails for array-like text", () => {
			const input = "[invalid array"
			expect(formatUnknownMessageContent(input, "fallback")).toBe(input)
		})

		it("should return text as-is for truncated JSON", () => {
			const input = '{"key": "val'
			expect(formatUnknownMessageContent(input, "fallback")).toBe(input)
		})
	})

	describe("edge cases", () => {
		it("should handle JSON with special characters", () => {
			const input = '{"message":"Hello\\nWorld"}'
			const expected = JSON.stringify({ message: "Hello\nWorld" }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should handle empty JSON object", () => {
			const input = "{}"
			const expected = "{}"
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should handle empty JSON array", () => {
			const input = "[]"
			const expected = "[]"
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should handle JSON with null values", () => {
			const input = '{"key":null}'
			const expected = JSON.stringify({ key: null }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should handle JSON with boolean values", () => {
			const input = '{"active":true,"disabled":false}'
			const expected = JSON.stringify({ active: true, disabled: false }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})

		it("should handle JSON with numeric values", () => {
			const input = '{"count":42,"price":19.99}'
			const expected = JSON.stringify({ count: 42, price: 19.99 }, null, 2)
			expect(formatUnknownMessageContent(input, "fallback")).toBe(expected)
		})
	})
})
