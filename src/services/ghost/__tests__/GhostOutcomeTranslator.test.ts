import * as vscode from "vscode"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { GhostOutcomeTranslator } from "../GhostOutcomeTranslator"
import { AutocompleteOutcome } from "../types"

// Mock vscode.workspace
vi.mock("vscode", async () => {
	const actual = await vi.importActual<typeof vscode>("vscode")
	return {
		...actual,
		workspace: {
			...actual.workspace,
			asRelativePath: vi.fn((uri: vscode.Uri) => uri.fsPath),
		},
	}
})

describe("GhostOutcomeTranslator", () => {
	let translator: GhostOutcomeTranslator

	beforeEach(() => {
		translator = new GhostOutcomeTranslator()
	})

	const createMockDocument = (content: string, filepath: string = "/test/file.ts"): vscode.TextDocument => {
		return {
			getText: () => content,
			offsetAt: (pos: vscode.Position) => {
				const lines = content.split("\n")
				let offset = 0
				for (let i = 0; i < pos.line && i < lines.length; i++) {
					offset += lines[i].length + 1 // +1 for newline
				}
				offset += pos.character
				return offset
			},
			uri: { fsPath: filepath } as vscode.Uri,
			isUntitled: false,
			languageId: "typescript",
		} as unknown as vscode.TextDocument
	}

	const createMockOutcome = (completion: string, filepath: string = "/test/file.ts"): AutocompleteOutcome => {
		return {
			completion,
			prefix: "",
			suffix: "",
			prompt: "",
			modelProvider: "test",
			modelName: "test-model",
			completionOptions: {},
			cacheHit: false,
			numLines: completion.split("\n").length,
			filepath,
			completionId: "test-id",
			uniqueId: "unique-id",
			timestamp: new Date().toISOString(),
			time: 100,
			disable: false,
			maxPromptTokens: 1000,
			debounceDelay: 300,
			modelTimeout: 5000,
			maxSuffixPercentage: 50,
			prefixPercentage: 50,
			multilineCompletions: "auto",
			slidingWindowPrefixPercentage: 75,
			slidingWindowSize: 500,
		}
	}

	describe("translate", () => {
		it("should convert simple single-line completion to suggestions", () => {
			const document = createMockDocument("const x = ")
			const outcome = createMockOutcome("1")
			const cursorPosition = new vscode.Position(0, 10)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(true)
			const file = result.getFile(document.uri)
			expect(file).toBeDefined()
			
			const operations = file?.getAllOperations() ?? []
			expect(operations.length).toBeGreaterThan(0)
		})

		it("should convert multi-line completion to suggestions", () => {
			const document = createMockDocument("function test() {\n  \n}")
			const outcome = createMockOutcome("const x = 1;\n  return x;")
			const cursorPosition = new vscode.Position(1, 2)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(true)
			const file = result.getFile(document.uri)
			expect(file).toBeDefined()
			
			const operations = file?.getAllOperations() ?? []
			expect(operations.length).toBeGreaterThan(0)
			
			// Should have addition operations
			const additions = operations.filter((op) => op.type === "+")
			expect(additions.length).toBeGreaterThan(0)
		})

		it("should handle empty completion", () => {
			const document = createMockDocument("const x = 1")
			const outcome = createMockOutcome("")
			const cursorPosition = new vscode.Position(0, 11)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(false)
		})

		it("should handle completion at start of file", () => {
			const document = createMockDocument("world")
			const outcome = createMockOutcome("hello ")
			const cursorPosition = new vscode.Position(0, 0)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(true)
			const file = result.getFile(document.uri)
			const operations = file?.getAllOperations() ?? []
			
			// Should have additions for "hello "
			const additions = operations.filter((op) => op.type === "+")
			expect(additions.length).toBeGreaterThan(0)
		})

		it("should handle completion at end of file", () => {
			const document = createMockDocument("hello")
			const outcome = createMockOutcome(" world")
			const cursorPosition = new vscode.Position(0, 5)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(true)
			const file = result.getFile(document.uri)
			const operations = file?.getAllOperations() ?? []
			
			const additions = operations.filter((op) => op.type === "+")
			expect(additions.length).toBeGreaterThan(0)
		})

		it("should handle completion with newlines", () => {
			const document = createMockDocument("const x = 1")
			const outcome = createMockOutcome(";\nconst y = 2;")
			const cursorPosition = new vscode.Position(0, 11)

			const result = translator.translate(outcome, document, cursorPosition)

			expect(result.hasSuggestions()).toBe(true)
			const file = result.getFile(document.uri)
			const operations = file?.getAllOperations() ?? []
			
			// Should have multiple addition operations for the new lines
			const additions = operations.filter((op) => op.type === "+")
			expect(additions.length).toBeGreaterThan(0)
		})
	})
})