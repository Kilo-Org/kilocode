import * as vscode from "vscode"
import { describe, it, expect, beforeEach } from "vitest"
import { AutoTriggerStrategy } from "../AutoTriggerStrategy"
import { GhostSuggestionContext } from "../../types"

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
			const mockDocument = {
				languageId: "typescript",
				getText: () => "// TODO: implement sum function\n",
				lineAt: (line: number) => ({
					text: line === 0 ? "// TODO: implement sum function" : "",
					lineNumber: line,
				}),
				lineCount: 2,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 1 ? 32 : 0),
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 1, character: 0 } as vscode.Position,
				end: { line: 1, character: 0 } as vscode.Position,
				isEmpty: true,
			} as vscode.Range

			const context: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const { systemPrompt, userPrompt } = strategy.getPrompts(context)

			// Verify system prompt contains comment-specific keywords
			expect(systemPrompt.toLowerCase()).toContain("comment")
			expect(systemPrompt).toContain("TODO")
			expect(systemPrompt).toContain("implement")

			// Verify user prompt contains comment context
			expect(userPrompt).toContain("Comment-Driven Development")
			expect(userPrompt).toContain("implement sum function")
		})

		it("should use comment-specific prompts when cursor is on comment line", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "// FIXME: handle edge case\n",
				lineAt: (line: number) => ({
					text: "// FIXME: handle edge case",
					lineNumber: line,
				}),
				lineCount: 1,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 0,
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 0, character: 26 } as vscode.Position,
				end: { line: 0, character: 26 } as vscode.Position,
				isEmpty: true,
			} as vscode.Range

			const context: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const { systemPrompt, userPrompt } = strategy.getPrompts(context)

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
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({
					text: "const x = 1;",
				}),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 0, character: 13 } as vscode.Position,
				end: { line: 0, character: 13 } as vscode.Position,
			} as vscode.Range

			const context: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const { systemPrompt, userPrompt } = strategy.getPrompts(context)

			// Verify system prompt contains auto-trigger keywords
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).toContain("non-intrusive")

			// Verify user prompt contains auto-trigger instructions
			expect(userPrompt).toContain("minimal, obvious completion")
			expect(userPrompt).toContain("Single line preferred")
		})

		it("should not treat empty line without preceding comment as comment-driven", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n\n",
				lineAt: (line: number) => ({
					text: line === 0 ? "const x = 1;" : "",
					lineNumber: line,
				}),
				lineCount: 3,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 1 ? 13 : 0),
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 1, character: 0 } as vscode.Position,
				end: { line: 1, character: 0 } as vscode.Position,
				isEmpty: true,
			} as vscode.Range

			const context: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const { systemPrompt } = strategy.getPrompts(context)

			// Should use auto-trigger, not comment-driven
			expect(systemPrompt).toContain("Auto-Completion")
			expect(systemPrompt).not.toContain("Comment-Driven")
		})
	})
})
