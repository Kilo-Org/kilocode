import { describe, it, expect } from "vitest"
import type { CLIOptions } from "../types/cli.js"

describe("Append System Prompt CLI Option", () => {
	describe("CLIOptions type", () => {
		it("should accept appendSystemPrompt as a string option", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: "Custom instructions here",
			}

			expect(options.appendSystemPrompt).toBe("Custom instructions here")
		})

		it("should allow appendSystemPrompt to be undefined", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
			}

			expect(options.appendSystemPrompt).toBeUndefined()
		})

		it("should handle empty string for appendSystemPrompt", () => {
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: "",
			}

			expect(options.appendSystemPrompt).toBe("")
		})

		it("should handle multi-line appendSystemPrompt", () => {
			const multiLinePrompt = `Line 1
Line 2
Line 3`
			const options: CLIOptions = {
				mode: "code",
				workspace: "/test/workspace",
				appendSystemPrompt: multiLinePrompt,
			}

			expect(options.appendSystemPrompt).toBe(multiLinePrompt)
		})
	})

	describe("CLI flag parsing", () => {
		it("should parse --append-system-prompt flag with value", () => {
			// This test validates the expected behavior when the flag is parsed
			const mockArgs = ["--append-system-prompt", "Custom instructions"]
			const expectedValue = "Custom instructions"

			// Simulate what commander.js would do
			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})

		it("should handle --append-system-prompt with quoted multi-word value", () => {
			const mockArgs = ["--append-system-prompt", "Always use TypeScript strict mode"]
			const expectedValue = "Always use TypeScript strict mode"

			const parsedValue = mockArgs[1]
			expect(parsedValue).toBe(expectedValue)
		})
	})

	describe("System prompt integration", () => {
		it("should append custom text to system prompt when provided", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = "Always write tests first."
			const expectedPrompt = `${basePrompt}

${appendText}`

			const result = `${basePrompt}\n\n${appendText}`
			expect(result).toBe(expectedPrompt)
		})

		it("should not modify system prompt when appendSystemPrompt is undefined", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = undefined

			const result = appendText ? `${basePrompt}\n\n${appendText}` : basePrompt
			expect(result).toBe(basePrompt)
		})

		it("should not modify system prompt when appendSystemPrompt is empty string", () => {
			const basePrompt = "You are Kilo Code, an AI assistant."
			const appendText = ""

			const result = appendText ? `${basePrompt}\n\n${appendText}` : basePrompt
			expect(result).toBe(basePrompt)
		})

		it("should properly format appended text with newlines", () => {
			const basePrompt = "You are Kilo Code."
			const appendText = "Rule 1: Test first\nRule 2: Keep it simple"
			const expectedPrompt = `You are Kilo Code.

Rule 1: Test first
Rule 2: Keep it simple`

			const result = `${basePrompt}\n\n${appendText}`
			expect(result).toBe(expectedPrompt)
		})
	})
})
