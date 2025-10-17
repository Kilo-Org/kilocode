import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest"
import * as vscode from "vscode"
import { createSVGDecorationType, type SVGDecorationContent } from "../utils/createSVGDecorationType"
import { initializeHighlighter } from "../utils/CodeHighlighter"

// Mock the utilities
vi.mock("../utils/CodeHighlighter", () => ({
	initializeHighlighter: vi.fn().mockResolvedValue(undefined),
	getLanguageForDocument: vi.fn().mockReturnValue("typescript"),
	generateHighlightedHtmlWithRanges: vi.fn().mockResolvedValue({
		html: "<span>highlighted code</span>",
	}),
}))

vi.mock("../utils/SvgRenderer", () => ({
	SvgRenderer: vi.fn().mockImplementation(() => ({
		render: vi.fn().mockReturnValue("<svg><text>Mock SVG Content</text></svg>"),
	})),
}))

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		activeColorTheme: {
			kind: 1, // Dark theme
		},
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
	Uri: {
		parse: vi.fn((uri: string) => ({ toString: () => uri })),
	},
	DecorationRangeBehavior: {
		ClosedClosed: 1,
	},
	ColorThemeKind: {
		Dark: 1,
		Light: 2,
		HighContrast: 3,
		HighContrastLight: 4,
	},
	ThemeColor: vi.fn((color: any) => ({ id: color })),
	OverviewRulerLane: {
		Right: 7,
	},
}))

describe("createSVGDecorationType", () => {
	let mockDocument: vscode.TextDocument

	beforeAll(async () => {
		await initializeHighlighter()
	})

	beforeEach(() => {
		mockDocument = {
			uri: { fsPath: "/test/file.ts" },
			languageId: "typescript",
		} as vscode.TextDocument
		vi.clearAllMocks()
	})
	it("should create decoration type with simple text content", async () => {
		const content: SVGDecorationContent = {
			text: "console.log('hello')",
			backgroundRanges: [{ start: 0, end: 5, type: "modified" }],
		}
		const decorationType = await createSVGDecorationType(content, mockDocument)

		expect(vscode.window.createTextEditorDecorationType).toHaveBeenCalledWith(
			expect.objectContaining({
				after: expect.objectContaining({
					contentIconPath: expect.objectContaining({ toString: expect.any(Function) }),
					width: expect.stringMatching(/200px/),
					height: expect.stringMatching(/17px/),
				}),
			}),
		)
		expect(decorationType).toBeDefined()
	})

	it("should create decoration type with multi-line content", async () => {
		const content: SVGDecorationContent = {
			text: "line1\nline2\nline3",
			backgroundRanges: [{ start: 0, end: 5, type: "modified" }],
		}

		const decorationType = await createSVGDecorationType(content, mockDocument)
		expect(decorationType).toBeDefined()
	})

	it("should handle empty background ranges", async () => {
		const content: SVGDecorationContent = {
			text: "some text",
			backgroundRanges: [],
		}

		const decorationType = await createSVGDecorationType(content, mockDocument)
		expect(decorationType).toBeDefined()
	})

	it("should apply custom options", async () => {
		const content: SVGDecorationContent = {
			text: "test content",
			backgroundRanges: [{ start: 0, end: 4, type: "modified" }],
		}
		const options = { marginTop: 10, marginLeft: 20 }

		const decorationType = await createSVGDecorationType(content, mockDocument, options)
		expect(vscode.window.createTextEditorDecorationType).toHaveBeenCalledWith(
			expect.objectContaining({
				after: expect.objectContaining({
					border: expect.stringContaining("margin-top: 10px"),
				}),
			}),
		)
		expect(decorationType).toBeDefined()
	})

	it("should handle code highlighting errors gracefully", async () => {
		// Mock the code highlighter to throw an error
		const { generateHighlightedHtmlWithRanges } = await import("../utils/CodeHighlighter")
		;(generateHighlightedHtmlWithRanges as any).mockRejectedValueOnce(new Error("Highlighting failed"))

		const content: SVGDecorationContent = {
			text: "failing code",
			backgroundRanges: [{ start: 0, end: 4, type: "modified" }],
		}

		// Should not throw, but fall back to plain text
		const decorationType = await createSVGDecorationType(content, mockDocument)
		expect(decorationType).toBeDefined()
	})
})
