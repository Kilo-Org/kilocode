import { describe, it, expect, beforeEach, vi } from "vitest"
import * as vscode from "vscode"
import { GhostJetbrainsBridge } from "../GhostJetbrainsBridge"
import { GhostServiceManager } from "../GhostServiceManager"

// Mock vscode module
vi.mock("vscode", () => ({
	Uri: {
		parse: vi.fn((uri: string) => ({ toString: () => uri, fsPath: uri })),
	},
	Position: class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Range: class Range {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
	EndOfLine: {
		LF: 1,
		CRLF: 2,
	},
	InlineCompletionTriggerKind: {
		Invoke: 0,
		Automatic: 1,
	},
	CancellationTokenSource: class CancellationTokenSource {
		token = { isCancellationRequested: false }
		dispose = vi.fn()
	},
}))

describe("GhostJetbrainsBridge", () => {
	let bridge: GhostJetbrainsBridge
	let mockGhost: any

	beforeEach(() => {
		mockGhost = {
			inlineCompletionProvider: {
				provideInlineCompletionItems: vi.fn().mockResolvedValue([
					{
						insertText: "console.log('test')",
						range: {
							start: { line: 0, character: 0 },
							end: { line: 0, character: 10 },
						},
					},
				]),
				fimPromptBuilder: {},
				holeFiller: {},
			},
		} as any

		bridge = new GhostJetbrainsBridge(mockGhost)
	})

	describe("parseAndValidateArgs", () => {
		it("should parse arguments when passed as array", async () => {
			const args = [["file:///test.ts", { line: 5, character: 10 }, "const x = 1", "typescript", "req-123"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.requestId).toBe("req-123")
			expect(result.error).toBeNull()
		})

		it("should parse arguments when passed separately", async () => {
			const args = ["file:///test.ts", { line: 5, character: 10 }, "const x = 1", "typescript", "req-456"]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.requestId).toBe("req-456")
			expect(result.error).toBeNull()
		})

		it("should handle invalid position gracefully", async () => {
			const args = [["file:///test.ts", null, "const x = 1", "typescript", "req-789"]]

			const result = await bridge.getInlineCompletions(...args)

			// Should default to position 0,0
			expect(mockGhost.inlineCompletionProvider.provideInlineCompletionItems).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({ line: 0, character: 0 }),
				expect.anything(),
				expect.anything(),
			)
		})

		it("should convert non-string values to strings", async () => {
			const args = [[123 as any, { line: 0, character: 0 }, 456 as any, 789 as any, 999 as any]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.error).toBeNull()
		})
	})

	describe("normalizeContent", () => {
		it("should normalize CRLF line endings to LF", async () => {
			const content = "line1\r\nline2\r\nline3"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-1"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]
			expect(mockDocument.getText()).toBe("line1\nline2\nline3")
		})

		it("should normalize CR line endings to LF", async () => {
			const content = "line1\rline2\rline3"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-2"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]
			expect(mockDocument.getText()).toBe("line1\nline2\nline3")
		})

		it("should handle mixed line endings", async () => {
			const content = "line1\r\nline2\rline3\nline4"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-3"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]
			expect(mockDocument.getText()).toBe("line1\nline2\nline3\nline4")
		})
	})

	describe("createMockDocument", () => {
		it("should create a valid TextDocument mock", async () => {
			const content = "line1\nline2\nline3"
			const args = [["file:///test.ts", { line: 1, character: 5 }, content, "typescript", "req-4"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]

			expect(mockDocument.languageId).toBe("typescript")
			expect(mockDocument.lineCount).toBe(3)
			expect(mockDocument.getText()).toBe(content)
		})

		it("should implement getText with range correctly", async () => {
			const content = "line1\nline2\nline3"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-5"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]

			// Test single line range
			const range1 = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5))
			expect(mockDocument.getText(range1)).toBe("line1")

			// Test multi-line range
			const range2 = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(1, 5))
			expect(mockDocument.getText(range2)).toBe("line1\nline2")
		})

		it("should implement lineAt correctly", async () => {
			const content = "  const x = 1\nlet y = 2\n"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-6"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]

			const line = mockDocument.lineAt(0)
			expect(line.text).toBe("  const x = 1")
			expect(line.firstNonWhitespaceCharacterIndex).toBe(2)
			expect(line.isEmptyOrWhitespace).toBe(false)
		})

		it("should implement offsetAt correctly", async () => {
			const content = "abc\ndef\nghi"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-7"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]

			// Position at start of line 0
			expect(mockDocument.offsetAt(new vscode.Position(0, 0))).toBe(0)
			// Position at end of line 0
			expect(mockDocument.offsetAt(new vscode.Position(0, 3))).toBe(3)
			// Position at start of line 1
			expect(mockDocument.offsetAt(new vscode.Position(1, 0))).toBe(4)
		})

		it("should implement positionAt correctly", async () => {
			const content = "abc\ndef\nghi"
			const args = [["file:///test.ts", { line: 0, character: 0 }, content, "typescript", "req-8"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]

			// Offset 0 should be position 0,0
			const pos1 = mockDocument.positionAt(0)
			expect(pos1.line).toBe(0)
			expect(pos1.character).toBe(0)

			// Offset 4 should be position 1,0 (start of second line)
			const pos2 = mockDocument.positionAt(4)
			expect(pos2.line).toBe(1)
			expect(pos2.character).toBe(0)
		})
	})

	describe("serializeCompletionResult", () => {
		it("should serialize completion items correctly", async () => {
			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-9"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.requestId).toBe("req-9")
			expect(result.items).toHaveLength(1)
			expect(result.items[0].insertText).toBe("console.log('test')")
			expect(result.items[0].range).toEqual({
				start: { line: 0, character: 0 },
				end: { line: 0, character: 10 },
			})
			expect(result.error).toBeNull()
		})

		it("should handle completions with string insertText", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockResolvedValue([
				{
					insertText: "simple string",
					range: null,
				},
			])

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-10"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.items[0].insertText).toBe("simple string")
			expect(result.items[0].range).toBeNull()
		})

		it("should handle completions with SnippetString insertText", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockResolvedValue([
				{
					insertText: { value: "snippet value" },
					range: null,
				},
			])

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-11"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.items[0].insertText).toBe("snippet value")
		})

		it("should handle InlineCompletionList format", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockResolvedValue({
				items: [
					{
						insertText: "from list",
						range: null,
					},
				],
			})

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-12"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.items).toHaveLength(1)
			expect(result.items[0].insertText).toBe("from list")
		})

		it("should handle empty completions", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockResolvedValue([])

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-13"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.items).toHaveLength(0)
			expect(result.error).toBeNull()
		})

		it("should handle undefined completions", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockResolvedValue(undefined)

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-14"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.items).toHaveLength(0)
			expect(result.error).toBeNull()
		})
	})

	describe("error handling", () => {
		it("should return error result when validation fails", async () => {
			const args = [[]] // Invalid args

			const result = await bridge.getInlineCompletions(...args)

			expect(result.requestId).toBe("")
			expect(result.items).toHaveLength(0)
			expect(result.error).toBeTruthy()
		})

		it("should return error result when provider throws", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockRejectedValue(
				new Error("Provider error"),
			)

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-15"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.requestId).toBe("")
			expect(result.items).toHaveLength(0)
			expect(result.error).toBe("Provider error")
		})

		it("should handle non-Error exceptions", async () => {
			mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mockRejectedValue("String error")

			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-16"]]

			const result = await bridge.getInlineCompletions(...args)

			expect(result.error).toBe("String error")
		})
	})

	describe("language determination", () => {
		it("should use provided languageId when valid", async () => {
			const args = [["file:///test.ts", { line: 0, character: 0 }, "const x = 1", "typescript", "req-17"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]
			expect(mockDocument.languageId).toBe("typescript")
		})

		it("should determine language from file extension when languageId is generic", async () => {
			const args = [["file:///test.py", { line: 0, character: 0 }, "x = 1", "text", "req-18"]]

			await bridge.getInlineCompletions(...args)

			const mockDocument = mockGhost.inlineCompletionProvider.provideInlineCompletionItems.mock.calls[0][0]
			expect(mockDocument.languageId).toBe("python")
		})
	})
})
