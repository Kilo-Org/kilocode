import { describe, it, expect } from "vitest"
import { formatToolInvocation } from "../../tools/helpers/toolResultFormatting"

/**
 * Regression tests to ensure XML protocol behavior remains unchanged
 * after adding native protocol support.
 */
describe("XML Protocol Regression Tests", () => {
	it("should format tool invocations as XML tags for xml protocol", () => {
		const result = formatToolInvocation(
			"read_file",
			{ path: "config.json", start_line: "1", end_line: "10" },
			"xml",
		)

		expect(result).toContain("<read_file>")
		expect(result).toContain("<path>")
		expect(result).toContain("config.json")
		expect(result).toContain("</path>")
		expect(result).toContain("<start_line>")
		expect(result).toContain("1")
		expect(result).toContain("</start_line>")
		expect(result).toContain("</read_file>")
	})

	it("should handle complex nested structures in XML format", () => {
		const result = formatToolInvocation(
			"execute_command",
			{
				command: "npm install",
				cwd: "/home/user/project",
			},
			"xml",
		)

		expect(result).toContain("<execute_command>")
		expect(result).toContain("<command>")
		expect(result).toContain("npm install")
		expect(result).toContain("</command>")
		expect(result).toContain("<cwd>")
		expect(result).toContain("/home/user/project")
		expect(result).toContain("</cwd>")
		expect(result).toContain("</execute_command>")
	})

	it("should handle empty parameters correctly in XML format", () => {
		const result = formatToolInvocation("list_files", {}, "xml")

		expect(result).toBe("<list_files>\n\n</list_files>")
	})

	it("should preserve XML format for tool results in conversation history", () => {
		// Simulate what happens in resumeTaskFromHistory for XML protocol
		const useNative = false // XML protocol

		const mockToolUse = {
			type: "tool_use",
			id: "toolu_123",
			name: "read_file",
			input: { path: "test.ts" },
		}

		if (!useNative) {
			// This is the conversion logic that should happen for XML
			const converted = {
				type: "text",
				text: formatToolInvocation(mockToolUse.name, mockToolUse.input as Record<string, any>, "xml"),
			}

			expect(converted.type).toBe("text")
			expect(converted.text).toContain("<read_file>")
			expect(converted.text).toContain("<path>")
			expect(converted.text).toContain("test.ts")
		} else {
			throw new Error("Should not reach here for XML protocol")
		}
	})
})
