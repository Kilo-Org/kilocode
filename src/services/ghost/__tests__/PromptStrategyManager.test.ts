import * as vscode from "vscode"
import { describe, it, expect, beforeEach } from "vitest"
import { PromptStrategyManager } from "../PromptStrategyManager"
import { GhostSuggestionContext } from "../types"

describe("PromptStrategyManager", () => {
	let manager: PromptStrategyManager

	beforeEach(() => {
		manager = new PromptStrategyManager()
	})

	describe("buildPrompt", () => {
		it("should generate prompts with base format instructions", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Complete this function",
			}

			const { systemPrompt } = manager.buildPrompt(context)

			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
		})

		it("should select UserRequestStrategy when user input is provided", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Add a function to calculate sum",
			}

			const { systemPrompt, userPrompt, strategy } = manager.buildPrompt(context)

			expect(strategy.name).toBe("User Request")
			expect(systemPrompt).toContain("Execute User's Explicit Request")
			expect(userPrompt).toContain("Add a function to calculate sum")
		})
	})

	describe("Strategy Selection", () => {
		it("should select appropriate strategy based on context", () => {
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

			const commentContext: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const result = manager.buildPrompt(commentContext)

			expect(result.strategy.name).toBe("Comment Driven")
		})

		it("should fallback to AutoTriggerStrategy when no specific strategy matches", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const result = manager.buildPrompt(context)

			expect(result.strategy.name).toBe("Auto Trigger")
		})
	})

	describe("Integration with Various Contexts", () => {
		it("should handle all use case contexts properly", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({ text: line === 0 ? "const x = 1;" : "" }),
				lineCount: 2,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 0 ? 13 : 14),
			} as vscode.TextDocument

			const contexts: Array<{ context: GhostSuggestionContext; expectedStrategy?: string }> = [
				{
					context: {
						document: mockDocument,
						userInput: "Add type annotation",
					},
					expectedStrategy: "User Request",
				},
				{
					context: {
						document: mockDocument,
						diagnostics: [
							{
								severity: vscode.DiagnosticSeverity.Error,
								message: "Type error",
								range: { start: { line: 0 } } as vscode.Range,
							} as vscode.Diagnostic,
						],
					},
				},
				{
					context: {
						document: mockDocument,
						range: {
							isEmpty: false,
							start: { line: 0, character: 0 },
							end: { line: 0, character: 12 },
						} as vscode.Range,
					},
				},
				{
					context: {
						document: mockDocument,
						range: {
							isEmpty: true,
							start: { line: 1, character: 0 },
						} as vscode.Range,
					},
				},
			]

			contexts.forEach(({ context, expectedStrategy }) => {
				const { systemPrompt, userPrompt, strategy } = manager.buildPrompt(context)

				expect(systemPrompt).toBeDefined()
				expect(systemPrompt.length).toBeGreaterThan(0)
				expect(userPrompt).toBeDefined()
				expect(userPrompt.length).toBeGreaterThan(0)

				if (expectedStrategy) {
					expect(strategy.name).toBe(expectedStrategy)
				}
			})
		})
	})
})
