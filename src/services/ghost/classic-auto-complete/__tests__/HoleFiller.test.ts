import { describe, it, expect, beforeEach } from "vitest"
import { HoleFiller, parseGhostResponse } from "../HoleFiller"
import { AutocompleteInput } from "../../types"
import crypto from "crypto"

function createAutocompleteInput(
	filepath: string = "/test.ts",
	line: number = 0,
	character: number = 0,
): AutocompleteInput {
	return {
		isUntitledFile: false,
		completionId: crypto.randomUUID(),
		filepath,
		pos: { line, character },
		recentlyVisitedRanges: [],
		recentlyEditedRanges: [],
	}
}

describe("HoleFiller", () => {
	let holeFiller: HoleFiller

	beforeEach(() => {
		holeFiller = new HoleFiller()
	})

	describe("getPrompts", () => {
		it("should generate prompts with QUERY/FILL_HERE format", () => {
			const { systemPrompt, userPrompt } = holeFiller.getPrompts(
				createAutocompleteInput("/test.ts", 0, 13),
				"const x = 1;\n",
				"",
				"typescript",
			)

			// Verify system prompt contains auto-trigger keywords
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).toContain("non-intrusive")

			// Verify user prompt uses QUERY/FILL_HERE format
			expect(userPrompt).toContain("<QUERY>")
			expect(userPrompt).toContain("{{FILL_HERE}}")
			expect(userPrompt).toContain("</QUERY>")
			expect(userPrompt).toContain("COMPLETION")
		})

		it("should document context tags in system prompt", () => {
			const { systemPrompt } = holeFiller.getPrompts(
				createAutocompleteInput("/test.ts", 0, 13),
				"const x = 1;\n",
				"",
				"typescript",
			)

			// Verify system prompt documents the XML tags
			expect(systemPrompt).toContain("Context Tags")
			expect(systemPrompt).toContain("<LANGUAGE>")
			expect(systemPrompt).toContain("<RECENT_EDITS>")
			expect(systemPrompt).toContain("<QUERY>")
		})

		it("should include language ID in prompt with XML tags", () => {
			const { userPrompt } = holeFiller.getPrompts(
				createAutocompleteInput("/test.ts", 0, 13),
				"const x = 1;\n",
				"",
				"typescript",
			)

			expect(userPrompt).toContain("<LANGUAGE>typescript</LANGUAGE>")
		})

		it("should include recently edited ranges in prompt with XML tags", () => {
			const input = createAutocompleteInput("/test.ts", 5, 0)
			input.recentlyEditedRanges = [
				{
					filepath: "/test.ts",
					range: { start: { line: 2, character: 0 }, end: { line: 3, character: 0 } },
					timestamp: Date.now(),
					lines: ["function sum(a, b) {"],
					symbols: new Set(["sum"]),
				},
			]

			const { userPrompt } = holeFiller.getPrompts(input, "const x = 1;\n", "", "typescript")

			expect(userPrompt).toContain("<RECENT_EDITS>")
			expect(userPrompt).toContain("</RECENT_EDITS>")
			expect(userPrompt).toContain("Edited /test.ts at line 2")
		})

		it("should handle empty recently edited ranges", () => {
			const { userPrompt } = holeFiller.getPrompts(
				createAutocompleteInput("/test.ts", 0, 13),
				"const x = 1;\n",
				"",
				"typescript",
			)

			expect(userPrompt).not.toContain("<RECENT_EDITS>")
			expect(userPrompt).toContain("<LANGUAGE>typescript</LANGUAGE>")
		})

		it("should handle comments in code", () => {
			const { systemPrompt, userPrompt } = holeFiller.getPrompts(
				createAutocompleteInput("/test.ts", 1, 0),
				"// TODO: implement sum function\n",
				"",
				"typescript",
			)

			// Should use same prompt format
			expect(systemPrompt).toContain("Auto-Completion")
			expect(userPrompt).toContain("<QUERY>")
			expect(userPrompt).toContain("{{FILL_HERE}}")
			expect(userPrompt).toContain("</QUERY>")
			expect(userPrompt).toContain("COMPLETION")
		})
	})

	describe("parseGhostResponse", () => {
		const prefix = "function test() {\n  "
		const suffix = "\n}"

		describe("Response parsing with COMPLETION tags", () => {
			it("should extract content between COMPLETION tags", () => {
				const response = "<COMPLETION>return 42</COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("return 42")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle multiline content in COMPLETION tags", () => {
				const response = "<COMPLETION>const x = 1;\nconst y = 2;\nreturn x + y;</COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("const x = 1;\nconst y = 2;\nreturn x + y;")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle incomplete COMPLETION tag (streaming)", () => {
				const response = "<COMPLETION>return 42"
				const result = parseGhostResponse(response, prefix, suffix)

				// Incomplete tags should return empty string
				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should remove any accidental tag remnants", () => {
				const response = "<COMPLETION>return 42<COMPLETION></COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("return 42")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle case-insensitive tags", () => {
				const response = "<completion>return 42</completion>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("return 42")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})
		})

		describe("Response parsing without COMPLETION tags (no suggestions)", () => {
			it("should return empty string when no tags present", () => {
				const response = "return 42"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should return empty string for multiline response without tags", () => {
				const response = "const x = 1;\nconst y = 2;\nreturn x + y;"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should return empty string for markdown code blocks without tags", () => {
				const response = "```typescript\nreturn 42\n```"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})
		})

		describe("Edge cases", () => {
			it("should handle empty response", () => {
				const response = ""
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should return empty string for whitespace-only response without tags", () => {
				const response = "   \n\t  "
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle custom prefix/suffix with COMPLETION tags", () => {
				const customPrefix = "const greeting = "
				const customSuffix = ";"
				const response = '<COMPLETION>"Hello, World!"</COMPLETION>'

				const result = parseGhostResponse(response, customPrefix, customSuffix)

				expect(result.text).toBe('"Hello, World!"')
				expect(result.prefix).toBe(customPrefix)
				expect(result.suffix).toBe(customSuffix)
			})

			it("should handle empty COMPLETION tags", () => {
				const response = "<COMPLETION></COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle whitespace-only content in COMPLETION tags", () => {
				const response = "<COMPLETION>   </COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("   ")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle response with extra text before COMPLETION tag", () => {
				const response = "Here is the code:\n<COMPLETION>return 42</COMPLETION>"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("return 42")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})

			it("should handle response with extra text after COMPLETION tag", () => {
				const response = "<COMPLETION>return 42</COMPLETION>\nThat's the code!"
				const result = parseGhostResponse(response, prefix, suffix)

				expect(result.text).toBe("return 42")
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})
		})

		describe("performance", () => {
			it("should handle large responses efficiently", () => {
				const largeContent = "x".repeat(10000)
				const response = `<COMPLETION>${largeContent}</COMPLETION>`

				const startTime = performance.now()
				const result = parseGhostResponse(response, prefix, suffix)
				const endTime = performance.now()

				expect(endTime - startTime).toBeLessThan(100)
				expect(result.text).toBe(largeContent)
				expect(result.prefix).toBe(prefix)
				expect(result.suffix).toBe(suffix)
			})
		})
	})
})
