import * as vscode from "vscode"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { GhostStrategy } from "../GhostStrategy"
import { GhostSuggestionContext } from "../types"
import { PromptStrategyManager } from "../PromptStrategyManager"
import { UseCaseType } from "../types/PromptStrategy"
import { skip } from "node:test"

describe("GhostStrategy", () => {
	let strategy: GhostStrategy

	beforeEach(() => {
		strategy = new GhostStrategy()
	})

	describe("getSystemPrompt", () => {
		it("should use PromptStrategyManager to generate system prompt", () => {
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

			const prompt = strategy.getSystemPrompt(context)

			// Should contain base instructions from strategy system
			expect(prompt).toContain("CRITICAL OUTPUT FORMAT")
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

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			// UserRequestStrategy should be selected
			expect(systemPrompt).toContain("Execute User's Explicit Request")
			expect(userPrompt).toContain("Add a function to calculate sum")
		})

		skip("should select ErrorFixStrategy when diagnostics are present", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1",
				lineAt: (line: number) => ({ text: "const x = 1" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 11,
			} as vscode.TextDocument

			const mockRange = {
				start: { line: 0, character: 11 } as vscode.Position,
				end: { line: 0, character: 11 } as vscode.Position,
			} as vscode.Range

			const context: GhostSuggestionContext = {
				document: mockDocument,
				diagnostics: [
					{
						severity: vscode.DiagnosticSeverity.Error,
						message: "Missing semicolon",
						range: mockRange,
					} as vscode.Diagnostic,
				],
			}

			const systemPrompt = strategy.getSystemPrompt(context)

			// ErrorFixStrategy should be selected
			expect(systemPrompt).toContain("Fix Compilation Errors and Warnings")
		})
	})

	describe("getSuggestionPrompt", () => {
		it("should delegate to PromptStrategyManager", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const prompt = strategy.getSuggestionPrompt(context)

			// Should return a structured prompt
			expect(prompt).toBeDefined()
			expect(prompt.length).toBeGreaterThan(0)
		})
	})

	describe("Integration", () => {
		it("should work with both system and user prompts", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				lineAt: (line: number) => ({ text: "const x = 1;" }),
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
				userInput: "Complete this function",
			}

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			// System prompt should contain format instructions
			expect(systemPrompt).toContain("CRITICAL OUTPUT FORMAT")
			// User prompt should contain the user input
			expect(userPrompt).toContain("Complete this function")
		})
	})

	describe("Strategy Selection", () => {
		let manager: PromptStrategyManager

		beforeEach(() => {
			manager = new PromptStrategyManager()
		})

		it("should have all 7 strategies registered", () => {
			const strategies = manager.getStrategies()
			expect(strategies).toHaveLength(7)

			const strategyNames = strategies.map((s) => s.name)
			expect(strategyNames).toContain("User Request")
			expect(strategyNames).toContain("Error Fix")
			expect(strategyNames).toContain("Selection Refactor")
			expect(strategyNames).toContain("Comment Driven")
			expect(strategyNames).toContain("New Line Completion")
			expect(strategyNames).toContain("Inline Completion")
			expect(strategyNames).toContain("Auto Trigger")
		})

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

			// Test comment-driven context
			const commentContext: GhostSuggestionContext = {
				document: mockDocument,
				range: mockRange,
			}

			const result = manager.buildPrompt(commentContext)

			// Should select NewLineCompletionStrategy when cursor is on empty line
			// (even if previous line has a comment, empty line takes precedence)
			expect(result.strategy.name).toBe("New Line Completion")
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

			// Should fallback to AutoTriggerStrategy
			expect(result.strategy.name).toBe("Auto Trigger")
		})
	})

	describe("Strategy System Integration", () => {
		it("should properly delegate to PromptStrategyManager", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;",
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => 13,
			} as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document: mockDocument,
			}

			const systemPrompt = strategy.getSystemPrompt(context)
			const userPrompt = strategy.getSuggestionPrompt(context)

			expect(systemPrompt).toBeDefined()
			expect(systemPrompt.length).toBeGreaterThan(0)
			expect(userPrompt).toBeDefined()
			expect(userPrompt.length).toBeGreaterThan(0)
		})
	})

	describe("Integration with PromptStrategyManager", () => {
		it("should properly integrate with strategy manager for all use cases", () => {
			const mockDocument = {
				languageId: "typescript",
				getText: () => "const x = 1;\n",
				lineAt: (line: number) => ({ text: line === 0 ? "const x = 1;" : "" }),
				lineCount: 2,
				uri: { toString: () => "file:///test.ts" },
				offsetAt: (position: vscode.Position) => (position.line === 0 ? 13 : 14),
			} as vscode.TextDocument

			// Test different contexts
			const contexts = [
				// User request
				{
					document: mockDocument,
					userInput: "Add type annotation",
				},
				// Error fix
				{
					document: mockDocument,
					diagnostics: [
						{
							severity: vscode.DiagnosticSeverity.Error,
							message: "Type error",
							range: { start: { line: 0 } } as vscode.Range,
						} as vscode.Diagnostic,
					],
				},
				// Selection refactor
				{
					document: mockDocument,
					range: {
						isEmpty: false,
						start: { line: 0, character: 0 },
						end: { line: 0, character: 12 },
					} as vscode.Range,
				},
				// New line completion
				{
					document: mockDocument,
					range: {
						isEmpty: true,
						start: { line: 1, character: 0 },
					} as vscode.Range,
				},
			]

			contexts.forEach((context) => {
				const systemPrompt = strategy.getSystemPrompt(context as GhostSuggestionContext)
				const userPrompt = strategy.getSuggestionPrompt(context as GhostSuggestionContext)

				expect(systemPrompt).toBeDefined()
				expect(systemPrompt.length).toBeGreaterThan(0)
				expect(userPrompt).toBeDefined()
				expect(userPrompt.length).toBeGreaterThan(0)
			})
		})
	})
})
