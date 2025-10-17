import { MermaidSyntaxFixer } from "../mermaidSyntaxFixer"
import { vi, beforeEach, afterEach } from "vitest"

// Mock the mermaid library
vi.mock("mermaid", () => ({
	default: {
		parse: vi.fn(),
	},
}))

// Mock i18next
vi.mock("i18next", () => ({
	default: {
		t: (key: string, options?: any) => {
			// Return a simple translation based on the key
			if (key === "common:mermaid.errors.unknown_syntax") return "Unknown syntax error"
			if (key === "common:mermaid.errors.fix_timeout") return "Fix timeout"
			if (key === "common:mermaid.errors.fix_request_failed") return "Fix request failed"
			if (key === "common:mermaid.errors.fix_attempts")
				return `Failed to fix syntax after ${options?.attempts} attempts: ${options?.error}`
			if (key === "common:mermaid.errors.no_fix_provided") return "LLM failed to provide a fix"
			return key
		},
	},
}))

describe("MermaidSyntaxFixer", () => {
	describe("applyDeterministicFixes", () => {
		it("should replace --&gt; with -->", () => {
			const input = "A --&gt; B"
			const expected = "A --> B"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should replace multiple instances of --&gt; with -->", () => {
			const input = "A --&gt; B\nB --&gt; C\nC --&gt; D"
			const expected = "A --> B\nB --> C\nC --> D"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should handle complex mermaid diagrams with --&gt; errors", () => {
			const input = `graph TD
    A[Start] --&gt; B{Decision}
    B --&gt; C[Option 1]
    B --&gt; D[Option 2]
    C --&gt; E[End]
    D --&gt; E`
			const expected = `graph TD
    A[Start] --> B{Decision}
    B --> C[Option 1]
    B --> D[Option 2]
    C --> E[End]
    D --> E`
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should not modify code that does not contain --&gt;", () => {
			const input = "A --> B\nB --> C"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(input)
		})

		it("should handle empty string", () => {
			const input = ""
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe("")
		})

		it("should handle string with only --&gt;", () => {
			const input = "--&gt;"
			const expected = "-->"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should preserve other HTML entities that are not --&gt;", () => {
			const input = "A --&gt; B &amp; C &lt; D"
			const expected = "A --> B &amp; C &lt; D"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should handle mixed content with --&gt; in different contexts", () => {
			const input = `flowchart LR
    A[User Input] --&gt; B[Process]
    B --&gt; C{Valid?}
    C --&gt;|Yes| D[Success]
    C --&gt;|No| E[Error]`
			const expected = `flowchart LR
    A[User Input] --> B[Process]
    B --> C{Valid?}
    C -->|Yes| D[Success]
    C -->|No| E[Error]`
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should handle --&gt; at the beginning and end of lines", () => {
			const input = "--&gt; start\nmiddle --&gt; middle\nend --&gt;"
			const expected = "--> start\nmiddle --> middle\nend -->"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		it("should handle --&gt; with surrounding whitespace", () => {
			const input = "A   --&gt;   B"
			const expected = "A   -->   B"
			const result = MermaidSyntaxFixer.applyDeterministicFixes(input)
			expect(result).toBe(expected)
		})

		describe("autoFixSyntax", () => {
			let validateSyntaxSpy: any
			let requestLLMFixSpy: any
			beforeEach(() => {
				validateSyntaxSpy = vi.spyOn(MermaidSyntaxFixer, "validateSyntax")
				requestLLMFixSpy = vi.spyOn(MermaidSyntaxFixer as any, "requestLLMFix")
			})

			afterEach(() => {
				vi.restoreAllMocks()
			})

			it("should return success when deterministic fixes are sufficient", async () => {
				// Mock successful validation after deterministic fixes
				validateSyntaxSpy.mockResolvedValue({ isValid: true })

				const result = await MermaidSyntaxFixer.autoFixSyntax("A --&gt; B")

				expect(result.success).toBe(true)
				expect(result.fixedCode).toBe("A --> B")
				expect(result.attempts).toBe(0)
				// requestLLMFix should NOT be called when validation passes after deterministic fixes
				expect(requestLLMFixSpy).not.toHaveBeenCalled()
			})

			it("should return success and fixed code when LLM validation succeeds", async () => {
				const applyDeterministicFixesSpy = vi.spyOn(MermaidSyntaxFixer, "applyDeterministicFixes")
				applyDeterministicFixesSpy.mockReturnValueOnce("original code") // First call
				applyDeterministicFixesSpy.mockReturnValueOnce("deterministically fixed code") // Second call after LLM fix

				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "error" }) // First validation fails
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: true }) // Second validation succeeds
				requestLLMFixSpy.mockResolvedValue({ fixedCode: "fixed code" })

				const result = await MermaidSyntaxFixer.autoFixSyntax("original code")

				expect(result.success).toBe(true)
				expect(result.fixedCode).toBe("deterministically fixed code")
				expect(result.attempts).toBe(1)
				expect(applyDeterministicFixesSpy).toHaveBeenCalledWith("fixed code")
			})

			it("should return the best attempt even when fix is not successful", async () => {
				// Mock failed validation for initial and both LLM attempts
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "initial error" })
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "error 1" })
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "error 2" })

				// Mock LLM fix attempts
				requestLLMFixSpy.mockResolvedValueOnce({ fixedCode: "first attempt" })
				requestLLMFixSpy.mockResolvedValueOnce({ fixedCode: "second attempt" })

				// Mock applyDeterministicFixes
				const applyDeterministicFixesSpy = vi.spyOn(MermaidSyntaxFixer, "applyDeterministicFixes")
				applyDeterministicFixesSpy.mockReturnValueOnce("original code") // Initial deterministic fix
				applyDeterministicFixesSpy.mockReturnValueOnce("deterministically fixed first attempt")
				applyDeterministicFixesSpy.mockReturnValueOnce("deterministically fixed second attempt")

				const result = await MermaidSyntaxFixer.autoFixSyntax("original code")

				expect(result.success).toBe(false)
				expect(result.fixedCode).toBe("deterministically fixed second attempt") // Should return the deterministically fixed last attempt
				expect(result.attempts).toBe(2)
				expect(result.error).toContain("Failed to fix syntax after 2 attempts")

				expect(applyDeterministicFixesSpy).toHaveBeenCalledTimes(3) // Initial + 2 LLM attempts
				expect(applyDeterministicFixesSpy).toHaveBeenNthCalledWith(2, "first attempt")
				expect(applyDeterministicFixesSpy).toHaveBeenNthCalledWith(3, "second attempt")
			})

			it("should return the best attempt when LLM request fails", async () => {
				// Mock failed initial validation
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "initial error" })

				// Mock successful first attempt but failed second attempt
				requestLLMFixSpy.mockResolvedValueOnce({ fixedCode: "first attempt" })
				requestLLMFixSpy.mockResolvedValueOnce({ requestError: "LLM request failed" })

				// Mock failed validation for first attempt
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "still invalid" })

				// Mock applyDeterministicFixes
				const applyDeterministicFixesSpy = vi.spyOn(MermaidSyntaxFixer, "applyDeterministicFixes")
				applyDeterministicFixesSpy.mockReturnValueOnce("original code") // Initial
				applyDeterministicFixesSpy.mockReturnValueOnce("deterministically fixed first attempt")

				const result = await MermaidSyntaxFixer.autoFixSyntax("original code")

				expect(result.success).toBe(false)
				expect(result.fixedCode).toBe("deterministically fixed first attempt") // Should return the deterministically fixed best attempt
				expect(result.error).toContain("LLM request failed")
				expect(applyDeterministicFixesSpy).toHaveBeenNthCalledWith(2, "first attempt")
			})

			it("should return the original code when LLM fails to provide a fix", async () => {
				// Mock failed initial validation
				validateSyntaxSpy.mockResolvedValueOnce({ isValid: false, error: "error" })

				// Mock LLM returning null (no fix provided)
				requestLLMFixSpy.mockResolvedValueOnce({ fixedCode: "" })

				// Mock applyDeterministicFixes to return the original code
				const applyDeterministicFixesSpy = vi.spyOn(MermaidSyntaxFixer, "applyDeterministicFixes")
				applyDeterministicFixesSpy.mockReturnValue("original code")

				const result = await MermaidSyntaxFixer.autoFixSyntax("original code")

				expect(result.success).toBe(false)
				expect(result.fixedCode).toBe("original code") // Should return the original code after deterministic fixes
				expect(result.error).toBe("LLM failed to provide a fix")
			})
		})
	})
})
