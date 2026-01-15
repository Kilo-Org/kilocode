import { describe, it, expect } from "vitest"
import { validateOnTaskCompletedPrompt } from "../on-task-completed.js"

/**
 * Tests for the --on-task-completed flag behavior.
 *
 * The --on-task-completed flag sends a user-defined prompt to the agent when the task completes.
 * The actual prompt sending is handled in useCIMode hook by intercepting the first completion_result.
 * These tests cover the validation logic.
 */
describe("CLI --on-task-completed flag", () => {
	describe("validateOnTaskCompletedPrompt", () => {
		it("should accept a valid prompt", () => {
			const result = validateOnTaskCompletedPrompt("Create a pull request")
			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
		})

		it("should reject an empty prompt", () => {
			const result = validateOnTaskCompletedPrompt("")
			expect(result.valid).toBe(false)
			expect(result.error).toContain("cannot be empty")
		})

		it("should reject a whitespace-only prompt", () => {
			const result = validateOnTaskCompletedPrompt("   \n\t  ")
			expect(result.valid).toBe(false)
			expect(result.error).toContain("cannot be empty")
		})

		it("should reject a prompt exceeding maximum length", () => {
			const longPrompt = "a".repeat(50001)
			const result = validateOnTaskCompletedPrompt(longPrompt)
			expect(result.valid).toBe(false)
			expect(result.error).toContain("exceeds maximum length")
			expect(result.error).toContain("50000")
		})

		it("should accept a prompt at maximum length", () => {
			const maxPrompt = "a".repeat(50000)
			const result = validateOnTaskCompletedPrompt(maxPrompt)
			expect(result.valid).toBe(true)
		})

		describe("special characters and markdown", () => {
			it("should accept prompts with markdown formatting", () => {
				const markdownPrompt = `# Create a PR

## Steps:
1. **Commit** all changes
2. *Push* to remote
3. Create PR with \`gh pr create\`

\`\`\`bash
git add -A
git commit -m "feat: new feature"
\`\`\`
`
				const result = validateOnTaskCompletedPrompt(markdownPrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with special characters", () => {
				const specialChars = "Test with special chars: @#$%^&*()[]{}|\\;:'\",.<>?/`~"
				const result = validateOnTaskCompletedPrompt(specialChars)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with unicode characters", () => {
				const unicodePrompt = "Create PR with emoji 🚀 and unicode: äöü 中文 日本語"
				const result = validateOnTaskCompletedPrompt(unicodePrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with newlines", () => {
				const multilinePrompt = "Line 1\nLine 2\r\nLine 3\rLine 4"
				const result = validateOnTaskCompletedPrompt(multilinePrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with tabs and mixed whitespace", () => {
				const whitespacePrompt = "Step 1:\t\tDo this\n\t\tStep 2: Do that"
				const result = validateOnTaskCompletedPrompt(whitespacePrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with quotes", () => {
				const quotesPrompt = `Use "double quotes" and 'single quotes' and \`backticks\``
				const result = validateOnTaskCompletedPrompt(quotesPrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with escape sequences", () => {
				const escapePrompt = "Path: C:\\Users\\test\\file.txt and \\n literal"
				const result = validateOnTaskCompletedPrompt(escapePrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with JSON content", () => {
				const jsonPrompt = `Create a config file with: {"key": "value", "array": [1, 2, 3]}`
				const result = validateOnTaskCompletedPrompt(jsonPrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with shell commands", () => {
				const shellPrompt = `Run: git add -A && git commit -m "feat: $(date)" | tee log.txt`
				const result = validateOnTaskCompletedPrompt(shellPrompt)
				expect(result.valid).toBe(true)
			})

			it("should accept prompts with HTML/XML content", () => {
				const htmlPrompt = `Create <div class="test">content</div> and <self-closing />`
				const result = validateOnTaskCompletedPrompt(htmlPrompt)
				expect(result.valid).toBe(true)
			})
		})
	})
})
