import { isInsideCodeBlock, removeSpuriousNewlinesBeforeCodeBlockClosingFences } from "../markdown"

describe("isInsideCodeBlock", () => {
	it("returns false for normal markdown", () => {
		expect(isInsideCodeBlock("# Heading\n\nSome text")).toBe(false)
	})

	it("returns true for an unclosed fenced block", () => {
		expect(isInsideCodeBlock("```ruby\nputs 'hello'")).toBe(true)
	})

	it("returns false when the fenced block is closed", () => {
		expect(isInsideCodeBlock("```ruby\nputs 'hello'\n```\n\nMore text")).toBe(false)
	})

	it("returns true when the last fenced block is unclosed", () => {
		const prefix = `# Example

\`\`\`javascript
const x = 1
\`\`\`

Some text

\`\`\`typescript
const y: number = 2`
		expect(isInsideCodeBlock(prefix)).toBe(true)
	})
})

describe("removeSpuriousNewlinesBeforeCodeBlockClosingFences", () => {
	it("strips ALL leading newline(s) before a closing fence when prefix ends with a newline", () => {
		const prefix = "```ruby\nputs 'yo'\n"

		const cases: Array<{ suggestion: string; expected: string }> = [
			{ suggestion: "\n```", expected: "```" },
			{ suggestion: "\n\n```\n\n# some heading", expected: "```\n\n# some heading" },
			{ suggestion: "\r\n```\r\n\r\n# heading", expected: "```\r\n\r\n# heading" },
		]

		for (const { suggestion, expected } of cases) {
			const result = removeSpuriousNewlinesBeforeCodeBlockClosingFences({ suggestion, prefix, suffix: "" })
			expect(result).toBe(expected)
		}
	})

	it("keeps exactly ONE leading newline before a closing fence when prefix does NOT end with a newline", () => {
		const prefix = "```ruby\nputs 'yo'"

		const cases: Array<{ suggestion: string; expected: string }> = [
			{ suggestion: "\n```", expected: "\n```" },
			{ suggestion: "\n\n```", expected: "\n```" },
			{ suggestion: "\n\n```\n\n# some heading", expected: "\n```\n\n# some heading" },
			{ suggestion: "\r\n```\r\n\r\n# heading", expected: "\r\n```\r\n\r\n# heading" },
			{ suggestion: "\r\n\r\n```\r\n\r\n# heading", expected: "\r\n```\r\n\r\n# heading" },
		]

		for (const { suggestion, expected } of cases) {
			const result = removeSpuriousNewlinesBeforeCodeBlockClosingFences({ suggestion, prefix, suffix: "" })
			expect(result).toBe(expected)
		}
	})

	it("does not change suggestions that start with a newline but are not a closing fence", () => {
		const prefix = "```ruby\nputs 'yo'"
		const suggestion = "\nmore code here"
		const result = removeSpuriousNewlinesBeforeCodeBlockClosingFences({ suggestion, prefix, suffix: "" })
		expect(result).toBe("\nmore code here")
	})

	it("does not run when not inside a code block", () => {
		const prefix = "# Heading\n\nSome text"
		const suggestion = "\n```ruby\nputs 'yo'\n```"
		const result = removeSpuriousNewlinesBeforeCodeBlockClosingFences({ suggestion, prefix, suffix: "" })
		expect(result).toBe("\n```ruby\nputs 'yo'\n```")
	})

	it("handles empty suggestion", () => {
		const prefix = "```ruby\nputs 'yo'"
		const suggestion = ""
		const result = removeSpuriousNewlinesBeforeCodeBlockClosingFences({ suggestion, prefix, suffix: "" })
		expect(result).toBe("")
	})
})
