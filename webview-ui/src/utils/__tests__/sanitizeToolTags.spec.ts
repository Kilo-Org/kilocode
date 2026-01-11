// kilocode_change - new file
import { describe, it, expect } from "vitest"
import { sanitizeToolTags, containsToolTags } from "../sanitizeToolTags"

describe("sanitizeToolTags", () => {
	describe("sanitizeToolTags", () => {
		it("should return empty string for null/undefined input", () => {
			expect(sanitizeToolTags(null)).toBe("")
			expect(sanitizeToolTags(undefined)).toBe("")
			expect(sanitizeToolTags("")).toBe("")
		})

		it("should return unchanged text when no tool tags present", () => {
			const text = "Hello, this is a normal message without any tool tags."
			expect(sanitizeToolTags(text)).toBe(text)
		})

		it("should remove OpenAI-style tool call markers", () => {
			const text = `<|tool_calls_section_begin|> <|tool_call_begin|> functions.search_files:2
<|tool_call_argument_begin|> {"path": "src", "regex": "test"} <|tool_call_end|>
<|tool_calls_section_end|>`
			const result = sanitizeToolTags(text)
			expect(result).not.toContain("<|tool_calls_section_begin|>")
			expect(result).not.toContain("<|tool_call_begin|>")
			expect(result).not.toContain("<|tool_call_end|>")
			expect(result).not.toContain("<|tool_calls_section_end|>")
		})

		it("should remove bracket-style tool markers", () => {
			const text = `Looking at the file:

[read_file]

Let me check this.`
			const result = sanitizeToolTags(text)
			expect(result).not.toContain("[read_file]")
			expect(result).toContain("Looking at the file:")
			expect(result).toContain("Let me check this.")
		})

		it("should remove XML-style read_file tags", () => {
			const text = `Looking at the file:
<read_file>
<args>
<file>
<path>DEVELOPMENT.md</path>
</file>
</args>
</read_file>
Let me check this.`
			const result = sanitizeToolTags(text)
			expect(result).not.toContain("<read_file>")
			expect(result).not.toContain("</read_file>")
			expect(result).not.toContain("<args>")
			expect(result).not.toContain("<path>")
			expect(result).toContain("Looking at the file:")
			expect(result).toContain("Let me check this.")
		})

		it("should remove various tool tags", () => {
			const toolTags = [
				"<write_file></write_file>",
				"<execute_command></execute_command>",
				"<search_files></search_files>",
				"<list_files></list_files>",
				"<browser_action></browser_action>",
				"<ask_followup_question></ask_followup_question>",
				"<attempt_completion></attempt_completion>",
				"<use_mcp_tool></use_mcp_tool>",
				"<access_mcp_resource></access_mcp_resource>",
				"<apply_diff></apply_diff>",
				"<insert_content></insert_content>",
				"<search_and_replace></search_and_replace>",
			]

			for (const tag of toolTags) {
				const text = `Before ${tag} After`
				const result = sanitizeToolTags(text)
				expect(result).toBe("Before  After")
			}
		})

		it("should remove function call syntax", () => {
			const text = "functions.search_files:2 some text functions.read_file:1"
			const result = sanitizeToolTags(text)
			expect(result).not.toContain("functions.search_files:2")
			expect(result).not.toContain("functions.read_file:1")
			expect(result).toContain("some text")
		})

		it("should clean up multiple consecutive newlines", () => {
			const text = `Before


<read_file></read_file>



After`
			const result = sanitizeToolTags(text)
			expect(result).not.toMatch(/\n{3,}/)
		})

		it("should handle mixed content with tool tags", () => {
			const text = `I'll help you with that.

<|tool_calls_section_begin|> <|tool_call_begin|> functions.read_file:1
<|tool_call_argument_begin|> {"path": "src/test.ts"} <|tool_call_end|>
<|tool_calls_section_end|>

Let me analyze the code.`
			const result = sanitizeToolTags(text)
			expect(result).toContain("I'll help you with that.")
			expect(result).toContain("Let me analyze the code.")
			expect(result).not.toContain("<|tool_calls_section_begin|>")
		})
	})

	describe("containsToolTags", () => {
		it("should return false for null/undefined/empty input", () => {
			expect(containsToolTags(null)).toBe(false)
			expect(containsToolTags(undefined)).toBe(false)
			expect(containsToolTags("")).toBe(false)
		})

		it("should return false for text without tool tags", () => {
			expect(containsToolTags("Hello, this is normal text.")).toBe(false)
		})

		it("should return true for text with OpenAI-style markers", () => {
			expect(containsToolTags("<|tool_calls_section_begin|>")).toBe(true)
			expect(containsToolTags("<|tool_call_begin|>")).toBe(true)
		})

		it("should return true for text with bracket-style markers", () => {
			expect(containsToolTags("[read_file]")).toBe(true)
			expect(containsToolTags("[write_file]")).toBe(true)
		})

		it("should return true for text with XML-style tool tags", () => {
			expect(containsToolTags("<read_file>")).toBe(true)
			expect(containsToolTags("<write_file>")).toBe(true)
			expect(containsToolTags("<execute_command>")).toBe(true)
		})

		it("should return true for text with function call syntax", () => {
			expect(containsToolTags("functions.search_files:2")).toBe(true)
		})
	})
})
