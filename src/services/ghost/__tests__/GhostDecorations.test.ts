import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest"
import * as vscode from "vscode"
import { GhostDecorations } from "../GhostDecorations"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"
import { initializeHighlighter } from "../utils/CodeHighlighter"

// Mock the utilities
vi.mock("../utils/CodeHighlighter", () => ({
	initializeHighlighter: vi.fn().mockResolvedValue(undefined),
	getLanguageForDocument: vi.fn().mockReturnValue("typescript"),
}))

vi.mock("../utils/SvgRenderer", () => ({
	generateCodeSVG: vi.fn().mockResolvedValue("data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="),
}))

vi.mock("../utils/HtmlToSvgRenderer", () => ({
	calculateTipDimensions: vi.fn().mockReturnValue({ width: 200, height: 100 }),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		activeTextEditor: null,
		activeColorTheme: {
			kind: 2, // Dark theme
		},
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
	},
	workspace: {
		getConfiguration: vi.fn(() => ({
			get: vi.fn((key: string) => {
				switch (key) {
					case "fontSize":
						return 14
					case "fontFamily":
						return "Consolas, 'Courier New', monospace"
					case "lineHeight":
						return 1.2
					default:
						return undefined
				}
			}),
		})),
	},
	ColorThemeKind: {
		Light: 1,
		Dark: 2,
		HighContrast: 3,
		HighContrastLight: 4,
	},
	ThemeColor: vi.fn((color: any) => ({ id: color })),
	OverviewRulerLane: {
		Right: 7,
	},
	Range: vi.fn((start: any, end: any) => ({ start, end })),
	Position: vi.fn((line: any, character: any) => ({ line, character })),
	Selection: vi.fn((startLine: any, startChar: any, endLine: any, endChar: any) => ({
		start: { line: startLine, character: startChar },
		end: { line: endLine, character: endChar },
	})),
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path, toString: () => path })),
		parse: vi.fn((uri: string) => ({ toString: () => uri })),
	},
	DecorationRangeBehavior: {
		ClosedClosed: 1,
	},
}))

describe("GhostDecorations", () => {
	let ghostDecorations: GhostDecorations
	let mockEditor: any
	let mockDocument: any
	let ghostSuggestions: GhostSuggestionsState
	let mockUri: vscode.Uri

	beforeAll(async () => {
		await initializeHighlighter()
	})

	beforeEach(() => {
		ghostDecorations = new GhostDecorations()
		ghostSuggestions = new GhostSuggestionsState()
		mockUri = vscode.Uri.file("/test/file.ts")

		// Create mock document with 5 lines
		mockDocument = {
			uri: mockUri,
			lineCount: 5,
			lineAt: vi.fn((lineNumber: number) => {
				if (lineNumber < 0 || lineNumber >= 5) {
					throw new Error(`Line ${lineNumber} does not exist`)
				}
				return {
					range: {
						start: { line: lineNumber, character: 0 },
						end: { line: lineNumber, character: 10 },
					},
					text: `line ${lineNumber}`,
				}
			}),
		}

		mockEditor = {
			document: mockDocument,
			setDecorations: vi.fn(),
		}

		// Mock activeTextEditor
		;(vscode.window as any).activeTextEditor = mockEditor
	})

	afterEach(() => {
		vi.clearAllMocks()
	})

	describe("getEditorConfiguration", () => {
		it("should handle line height as multiplier (< 8)", () => {
			// Mock configuration with line height as multiplier
			const mockConfig = {
				get: vi.fn((key: string) => {
					switch (key) {
						case "fontSize":
							return 14
						case "fontFamily":
							return "Consolas, 'Courier New', monospace"
						case "lineHeight":
							return 1.5 // Multiplier
						default:
							return undefined
					}
				}),
			}
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

			// Access the private method through reflection for testing
			const config = (ghostDecorations as any).getEditorConfiguration()

			expect(config.fontSize).toBe(14)
			expect(config.lineHeight).toBe(1.5) // Should remain as multiplier
		})

		it("should handle line height as absolute pixels (>= 8)", () => {
			// Mock configuration with line height as absolute pixels
			const mockConfig = {
				get: vi.fn((key: string) => {
					switch (key) {
						case "fontSize":
							return 16
						case "fontFamily":
							return "Monaco, monospace"
						case "lineHeight":
							return 24 // Absolute pixels
						default:
							return undefined
					}
				}),
			}
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

			// Access the private method through reflection for testing
			const config = (ghostDecorations as any).getEditorConfiguration()

			expect(config.fontSize).toBe(16)
			expect(config.lineHeight).toBe(1.5) // Should be converted: 24 / 16 = 1.5
		})

		it("should handle edge case line height of exactly 8", () => {
			// Mock configuration with line height of exactly 8 (should be treated as absolute)
			const mockConfig = {
				get: vi.fn((key: string) => {
					switch (key) {
						case "fontSize":
							return 16
						case "fontFamily":
							return "Monaco, monospace"
						case "lineHeight":
							return 8 // Edge case: exactly 8
						default:
							return undefined
					}
				}),
			}
			;(vscode.workspace.getConfiguration as any).mockReturnValue(mockConfig)

			// Access the private method through reflection for testing
			const config = (ghostDecorations as any).getEditorConfiguration()

			expect(config.fontSize).toBe(16)
			expect(config.lineHeight).toBe(0.5) // Should be converted: 8 / 16 = 0.5
		})
	})

	describe("displayAdditionsOperationGroup", () => {
		it("should handle additions at the end of document without throwing error", async () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add operation that tries to add content after the last line (line 5, but document only has lines 0-4)
			const addOp: GhostSuggestionEditOperation = {
				line: 6,
				oldLine: 5, // This line exists (0-indexed, so line 5 is the 6th line, but document only has 5 lines 0-4)
				newLine: 6,
				type: "+",
				content: "new line at end",
			}

			file.addOperation(addOp)
			file.selectClosestGroup(new vscode.Selection(5, 0, 5, 0))

			// This should not throw an error
			await expect(async () => {
				await ghostDecorations.displaySuggestions(ghostSuggestions)
			}).not.toThrow()

			// Should have called setDecorations
			expect(mockEditor.setDecorations).toHaveBeenCalled()
		})

		it("should handle additions beyond document end gracefully", () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add operation that tries to add content way beyond the document end
			const addOp: GhostSuggestionEditOperation = {
				line: 10,
				oldLine: 10, // Way beyond document end
				newLine: 10,
				type: "+",
				content: "new line way beyond end",
			}

			file.addOperation(addOp)
			file.selectClosestGroup(new vscode.Selection(5, 0, 5, 0))

			// This should not throw an error
			expect(() => {
				ghostDecorations.displaySuggestions(ghostSuggestions)
			}).not.toThrow()
		})

		it("should work correctly for additions within document bounds", async () => {
			const file = ghostSuggestions.addFile(mockUri)

			// Add operation within document bounds
			const addOp: GhostSuggestionEditOperation = {
				line: 3,
				oldLine: 2, // This line exists
				newLine: 3,
				type: "+",
				content: "new line in middle",
			}

			file.addOperation(addOp)
			file.selectClosestGroup(new vscode.Selection(2, 0, 2, 0))

			// This should work fine
			await expect(async () => {
				await ghostDecorations.displaySuggestions(ghostSuggestions)
			}).not.toThrow()

			// Should have called setDecorations with SVG decorations for additions
			expect(mockEditor.setDecorations).toHaveBeenCalledWith(
				expect.anything(), // SVG decoration type
				expect.arrayContaining([
					expect.objectContaining({
						range: expect.anything(),
					}),
				]),
			)
		})
	})
})
