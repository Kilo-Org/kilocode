import { describe, it, expect, beforeEach } from "vitest"
import { AutoTriggerStrategy } from "../AutoTriggerStrategy"
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

describe("AutoTriggerStrategy", () => {
	let strategy: AutoTriggerStrategy

	beforeEach(() => {
		strategy = new AutoTriggerStrategy()
	})

	describe("shouldTreatAsComment", () => {
		it("should return true when current line is a comment", () => {
			const prefix = "// TODO: implement"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(true)
		})

		it("should return true when current line is empty and previous line is a comment", () => {
			const prefix = "// TODO: implement\n"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(true)
		})

		it("should return false when current line is not a comment", () => {
			const prefix = "const x = 1;"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(false)
		})

		it("should return false when current line is empty and previous line is not a comment", () => {
			const prefix = "const x = 1;\n"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(false)
		})

		it("should return false when prefix is empty", () => {
			const prefix = ""
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(false)
		})

		it("should handle Python comments", () => {
			const prefix = "# TODO: implement"
			const result = strategy.shouldTreatAsComment(prefix, "python")
			expect(result).toBe(true)
		})

		it("should handle block comments", () => {
			const prefix = "/* TODO: implement */"
			const result = strategy.shouldTreatAsComment(prefix, "javascript")
			expect(result).toBe(true)
		})

		it("should handle multi-line prefix with comment on last line", () => {
			const prefix = "const x = 1;\nconst y = 2;\n// TODO: implement sum"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(true)
		})

		it("should handle multi-line prefix with empty last line after comment", () => {
			const prefix = "const x = 1;\n// TODO: implement sum\n"
			const result = strategy.shouldTreatAsComment(prefix, "typescript")
			expect(result).toBe(true)
		})
	})

	describe("getPrompts - comment-driven behavior", () => {
		it("should use comment-specific prompts when cursor is on empty line after comment", () => {
			const { systemPrompt, userPrompt } = strategy.getPrompts(
				createAutocompleteInput("/test.ts", 1, 0),
				"// TODO: implement sum function\n",
				"",
				"typescript",
			)

			// Verify system prompt contains comment-specific keywords
			expect(systemPrompt.toLowerCase()).toContain("comment")
			expect(systemPrompt).toContain("TODO")
			expect(systemPrompt).toContain("implement")

			// Verify user prompt contains comment context
			expect(userPrompt).toContain("Comment-Driven Development")
			expect(userPrompt).toContain("implement sum function")
		})

		it("should use comment-specific prompts when cursor is on comment line", () => {
			const { systemPrompt, userPrompt } = strategy.getPrompts(
				createAutocompleteInput("/test.ts", 0, 26),
				"// FIXME: handle edge case",
				"\n",
				"typescript",
			)

			// Verify system prompt contains comment-specific keywords
			expect(systemPrompt.toLowerCase()).toContain("comment")
			expect(systemPrompt).toContain("FIXME")

			// Verify user prompt contains comment context
			expect(userPrompt).toContain("Comment-Driven")
			expect(userPrompt).toContain("handle edge case")
		})
	})

	describe("getPrompts - auto-trigger behavior", () => {
		it("should use auto-trigger prompts for regular code completion", () => {
			const { systemPrompt, userPrompt } = strategy.getPrompts(
				createAutocompleteInput("/test.ts", 0, 13),
				"const x = 1;\n",
				"",
				"typescript",
			)

			// Verify system prompt contains auto-trigger keywords
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).toContain("non-intrusive")

			// Verify user prompt contains auto-trigger instructions
			expect(userPrompt).toContain("minimal, obvious completion")
			expect(userPrompt).toContain("Single line preferred")
		})

		it("should not treat empty line without preceding comment as comment-driven", () => {
			const { systemPrompt } = strategy.getPrompts(
				createAutocompleteInput("/test.ts", 1, 0),
				"const x = 1;\n",
				"\n",
				"typescript",
			)

			// Should use auto-trigger, not comment-driven
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).not.toContain("Comment-Driven")
		})
	})
})
