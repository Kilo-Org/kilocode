import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest"
import * as vscode from "vscode"
import { GhostDecorations } from "../GhostDecorations"
import { GhostSuggestionsState } from "../GhostSuggestions"
import { GhostSuggestionEditOperation } from "../types"
import { initializeHighlighter } from "../utils/CodeHighlighter"

// Mock the SVG decoration utilities
vi.mock("../utils/createSVGDecorationType", () => ({
	createSVGDecorationType: vi.fn().mockResolvedValue({
		dispose: vi.fn(),
	}),
}))

// Mock EditorConfiguration
vi.mock("../EditorConfiguration", () => ({
	getEditorConfiguration: vi.fn().mockReturnValue({
		fontSize: 14,
		fontFamily: "Consolas, 'Courier New', monospace",
		lineHeight: 1.2,
	}),
}))

// Mock text measurement utilities
vi.mock("../utils/textMeasurement", () => ({
	calculateContainerWidth: vi.fn().mockReturnValue(200),
	calculateCharacterWidth: vi.fn().mockReturnValue(8),
}))

// Mock ThemeMapper
vi.mock("../utils/ThemeMapper", () => ({
	getThemeColors: vi.fn().mockReturnValue({
		background: "#1e1e1e",
		foreground: "#cccccc",
	}),
}))

// Mock SvgRenderer
vi.mock("../utils/SvgRenderer", () => ({
	SvgRenderer: vi.fn().mockImplementation(() => ({
		render: vi.fn().mockReturnValue("<svg>test</svg>"),
	})),
}))

// Mock the utilities
vi.mock("../utils/CodeHighlighter", () => ({
	initializeHighlighter: vi.fn().mockResolvedValue(undefined),
	getLanguageForDocument: vi.fn().mockReturnValue("typescript"),
	generateHighlightedHtmlWithRanges: vi.fn().mockResolvedValue({
		html: "<span>highlighted code</span>",
	}),
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
