import { describe, it, expect, beforeEach, vi } from "vitest"
import { HoleFiller, parseGhostResponse, ProcessedSnippetsResult } from "../HoleFiller"
import { AutocompleteInput } from "../../types"
import crypto from "crypto"
import { AutocompleteSnippetType } from "../../../continuedev/core/autocomplete/snippets/types"
import { Typescript } from "../../../continuedev/core/autocomplete/constants/AutocompleteLanguageInfo"
import { DEFAULT_AUTOCOMPLETE_OPTS } from "../../../continuedev/core/util/parameters"

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

function createMockSnippetsResult(
	prefix: string,
	suffix: string,
	filepath: string,
	autocompleteInput: AutocompleteInput,
	snippetsWithUris: any[] = [],
	workspaceDirs: string[] = [],
): ProcessedSnippetsResult {
	const filepathUri = filepath.startsWith("file://") ? filepath : `file://${filepath}`

	return {
		filepathUri,
		helper: {
			lang: Typescript,
			treePath: undefined,
			workspaceUris: workspaceDirs,
			fileContents: prefix + suffix,
			fileLines: (prefix + suffix).split("\n"),
			fullPrefix: prefix,
			fullSuffix: suffix,
			prunedPrefix: prefix,
			prunedSuffix: suffix,
			input: autocompleteInput,
			options: DEFAULT_AUTOCOMPLETE_OPTS,
			modelName: "test-model",
			filepath: filepathUri,
			pos: autocompleteInput.pos,
			prunedCaretWindow: prefix + suffix,
		},
		snippetsWithUris,
		workspaceDirs,
	}
}

describe("HoleFiller", () => {
	let holeFiller: HoleFiller

	beforeEach(() => {
		vi.clearAllMocks()
		holeFiller = new HoleFiller()
	})

	describe("getPrompts", () => {
		it("should generate prompts with QUERY/FILL_HERE format", () => {
			const autocompleteInput = createAutocompleteInput("/test.ts", 0, 13)
			const snippetsResult = createMockSnippetsResult("const x = 1;\n", "", "/test.ts", autocompleteInput)
			const { systemPrompt, userPrompt } = holeFiller.getPrompts(snippetsResult, autocompleteInput, "typescript")

			// Verify system prompt contains auto-trigger keywords
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).toContain("Context Format")

			const expected = `<LANGUAGE>typescript</LANGUAGE>

<QUERY>

// test.ts
const x = 1;
{{FILL_HERE}}
</QUERY>

TASK: Fill the {{FILL_HERE}} hole. Answer only with the CORRECT completion, and NOTHING ELSE. Do it now.
Return the COMPLETION tags`

			expect(userPrompt).toBe(expected)
		})

		it("should include comment-wrapped context when snippets are provided", () => {
			const autocompleteInput = createAutocompleteInput("/app.ts", 5, 0)
			const snippetsResult = createMockSnippetsResult(
				"function calculate() {\n  ",
				"\n}",
				"/app.ts",
				autocompleteInput,
				[
					{
						filepath: "file:///utils.ts",
						content: "export function sum(a: number, b: number) {\n  return a + b\n}",
						type: AutocompleteSnippetType.Code,
					},
				],
				["file:///workspace"],
			)

			const { userPrompt } = holeFiller.getPrompts(snippetsResult, autocompleteInput, "typescript")

			// Use toContain for key parts instead of exact match to avoid whitespace issues
			expect(userPrompt).toContain("<LANGUAGE>typescript</LANGUAGE>")
			expect(userPrompt).toContain("// Path: utils.ts")
			expect(userPrompt).toContain("// export function sum(a: number, b: number)")
			expect(userPrompt).toContain("function calculate() {")
			expect(userPrompt).toContain("{{FILL_HERE}}")
			expect(userPrompt).toContain("TASK: Fill the {{FILL_HERE}} hole")
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
