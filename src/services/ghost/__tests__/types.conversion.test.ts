import * as vscode from "vscode"
import {
	extractPrefixSuffix,
	vscodePositionToPosition,
	vscodeRangeToRange,
	contextToAutocompleteInput,
	GhostSuggestionContext,
	UserActionType,
} from "../types"

describe("Type Conversion Utilities", () => {
	describe("extractPrefixSuffix", () => {
		it("should extract prefix and suffix at cursor position", () => {
			const document = {
				getText: () => "hello world\nfoo bar",
				offsetAt: (pos: vscode.Position) => {
					// "hello world\n" = 12 characters
					if (pos.line === 1 && pos.character === 4) {
						return 16 // "hello world\nfoo "
					}
					return 0
				},
			} as unknown as vscode.TextDocument

			const position = new vscode.Position(1, 4)
			const result = extractPrefixSuffix(document, position)

			expect(result.prefix).toBe("hello world\nfoo ")
			expect(result.suffix).toBe("bar")
		})

		it("should handle start of file", () => {
			const document = {
				getText: () => "hello world",
				offsetAt: () => 0,
			} as unknown as vscode.TextDocument

			const position = new vscode.Position(0, 0)
			const result = extractPrefixSuffix(document, position)

			expect(result.prefix).toBe("")
			expect(result.suffix).toBe("hello world")
		})

		it("should handle end of file", () => {
			const text = "hello world"
			const document = {
				getText: () => text,
				offsetAt: () => text.length,
			} as unknown as vscode.TextDocument

			const position = new vscode.Position(0, text.length)
			const result = extractPrefixSuffix(document, position)

			expect(result.prefix).toBe("hello world")
			expect(result.suffix).toBe("")
		})

		it("should handle empty file", () => {
			const document = {
				getText: () => "",
				offsetAt: () => 0,
			} as unknown as vscode.TextDocument

			const position = new vscode.Position(0, 0)
			const result = extractPrefixSuffix(document, position)

			expect(result.prefix).toBe("")
			expect(result.suffix).toBe("")
		})
	})

	describe("vscodePositionToPosition", () => {
		it("should convert VSCode Position to Position", () => {
			const vscodePos = new vscode.Position(5, 10)
			const result = vscodePositionToPosition(vscodePos)

			expect(result).toEqual({
				line: 5,
				character: 10,
			})
		})

		it("should handle position at start", () => {
			const vscodePos = new vscode.Position(0, 0)
			const result = vscodePositionToPosition(vscodePos)

			expect(result).toEqual({
				line: 0,
				character: 0,
			})
		})
	})

	describe("vscodeRangeToRange", () => {
		it("should convert VSCode Range to Range", () => {
			const vscodeRange = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(3, 4))
			const result = vscodeRangeToRange(vscodeRange)

			expect(result).toEqual({
				start: { line: 1, character: 2 },
				end: { line: 3, character: 4 },
			})
		})

		it("should handle single-point range", () => {
			const vscodeRange = new vscode.Range(new vscode.Position(5, 5), new vscode.Position(5, 5))
			const result = vscodeRangeToRange(vscodeRange)

			expect(result).toEqual({
				start: { line: 5, character: 5 },
				end: { line: 5, character: 5 },
			})
		})
	})

	describe("contextToAutocompleteInput", () => {
		it("should convert basic context to AutocompleteInput", () => {
			const document = {
				getText: () => "const x = 1\nconst y = 2",
				offsetAt: (pos: vscode.Position) => {
					if (pos.line === 1 && pos.character === 0) {
						return 12 // After "const x = 1\n"
					}
					return 0
				},
				uri: { fsPath: "/test/file.ts" } as vscode.Uri,
				isUntitled: false,
				positionAt: () => new vscode.Position(0, 0),
			} as unknown as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document,
				range: new vscode.Range(new vscode.Position(1, 0), new vscode.Position(1, 0)),
			}

			const result = contextToAutocompleteInput(context)

			expect(result.filepath).toBe("/test/file.ts")
			expect(result.isUntitledFile).toBe(false)
			expect(result.pos).toEqual({ line: 1, character: 0 })
			expect(result.manuallyPassPrefix).toBe("const x = 1\n")
			expect(result.completionId).toBeDefined()
			expect(result.recentlyVisitedRanges).toEqual([])
			expect(result.recentlyEditedRanges).toEqual([])
		})

		it("should convert context with recent operations", () => {
			const document = {
				getText: () => "const x = 1",
				offsetAt: () => 11,
				uri: { fsPath: "/test/file.ts" } as vscode.Uri,
				isUntitled: false,
				positionAt: () => new vscode.Position(0, 0),
			} as unknown as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document,
				range: new vscode.Range(new vscode.Position(0, 11), new vscode.Position(0, 11)),
				recentOperations: [
					{
						type: UserActionType.ADDITION,
						description: "Added variable",
						lineRange: { start: 0, end: 0 },
						affectedSymbol: "x",
						timestamp: 1234567890,
						content: "const x = 1",
					},
				],
			}

			const result = contextToAutocompleteInput(context)

			expect(result.recentlyEditedRanges).toHaveLength(1)
			expect(result.recentlyEditedRanges[0]).toMatchObject({
				filepath: "/test/file.ts",
				timestamp: 1234567890,
				lines: ["const x = 1"],
			})
			expect(result.recentlyEditedRanges[0].symbols.has("x")).toBe(true)
		})

		it("should handle untitled documents", () => {
			const document = {
				getText: () => "",
				offsetAt: () => 0,
				uri: { fsPath: "Untitled-1" } as vscode.Uri,
				isUntitled: true,
				positionAt: () => new vscode.Position(0, 0),
			} as unknown as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document,
			}

			const result = contextToAutocompleteInput(context)

			expect(result.isUntitledFile).toBe(true)
			expect(result.filepath).toBe("Untitled-1")
		})

		it("should use document start when no range provided", () => {
			const document = {
				getText: () => "test content",
				offsetAt: () => 0,
				uri: { fsPath: "/test/file.ts" } as vscode.Uri,
				isUntitled: false,
				positionAt: () => new vscode.Position(0, 0),
			} as unknown as vscode.TextDocument

			const context: GhostSuggestionContext = {
				document,
			}

			const result = contextToAutocompleteInput(context)

			expect(result.pos).toEqual({ line: 0, character: 0 })
			expect(result.manuallyPassPrefix).toBe("")
		})
	})
})
