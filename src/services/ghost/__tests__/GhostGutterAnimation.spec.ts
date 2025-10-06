import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { GhostGutterAnimation } from "../GhostGutterAnimation"

// Mock vscode module
vi.mock("vscode", () => ({
	window: {
		createTextEditorDecorationType: vi.fn(() => ({
			dispose: vi.fn(),
		})),
		activeTextEditor: null,
	},
	Uri: {
		joinPath: vi.fn(() => ({ fsPath: "mocked-path" })),
	},
	Position: class {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Range: class {
		constructor(
			public start: any,
			public end: any,
		) {}
	},
}))

describe("GhostGutterAnimation", () => {
	let animation: GhostGutterAnimation
	let mockContext: any
	let mockEditor: any
	let mockDocument: any

	beforeEach(() => {
		mockContext = {
			extensionUri: { fsPath: "/mock/path" },
		}

		mockDocument = {
			lineCount: 10,
			lineAt: vi.fn((line: number) => ({
				text: `line ${line} content`,
			})),
		}

		mockEditor = {
			selection: {
				active: new vscode.Position(5, 10),
			},
			document: mockDocument,
			setDecorations: vi.fn(),
		}

		animation = new GhostGutterAnimation(mockContext)
	})

	describe("getPosition bounds checking", () => {
		it("should handle valid cursor position", () => {
			// Setup valid position
			mockEditor.selection.active = new vscode.Position(5, 10)

			// Call private method via reflection
			const position = (animation as any).getPosition(mockEditor)

			expect(mockDocument.lineAt).toHaveBeenCalledWith(5)
			expect(position).toBeInstanceOf(vscode.Range)
		})

		it("should clamp negative line numbers to 0", () => {
			// Setup invalid negative position
			mockEditor.selection.active = new vscode.Position(-1, 10)

			// Call private method via reflection
			const position = (animation as any).getPosition(mockEditor)

			// Should clamp to line 0
			expect(mockDocument.lineAt).toHaveBeenCalledWith(0)
			expect(position).toBeInstanceOf(vscode.Range)
		})

		it("should clamp line numbers exceeding document length", () => {
			// Setup position beyond document end (lineCount = 10, so max valid line = 9)
			mockEditor.selection.active = new vscode.Position(15, 10)

			// Call private method via reflection
			const position = (animation as any).getPosition(mockEditor)

			// Should clamp to last line (lineCount - 1 = 9)
			expect(mockDocument.lineAt).toHaveBeenCalledWith(9)
			expect(position).toBeInstanceOf(vscode.Range)
		})

		it("should handle empty document", () => {
			// Setup empty document
			mockDocument.lineCount = 0
			mockEditor.selection.active = new vscode.Position(0, 0)

			// Since lineCount is 0, Math.min(0, 0-1) = Math.min(0, -1) = -1
			// But Math.max(0, -1) = 0, so it will try to access line 0
			// This might still be invalid for truly empty documents, but it's the best we can do
			const position = (animation as any).getPosition(mockEditor)

			expect(mockDocument.lineAt).toHaveBeenCalledWith(0)
		})

		it("should handle single line document", () => {
			// Setup single line document
			mockDocument.lineCount = 1
			mockEditor.selection.active = new vscode.Position(0, 5)

			const position = (animation as any).getPosition(mockEditor)

			expect(mockDocument.lineAt).toHaveBeenCalledWith(0)
		})
	})

	describe("update method", () => {
		it("should not crash when editor has out-of-bounds cursor position", () => {
			// Mock vscode.window.activeTextEditor to return our mock editor
			vi.mocked(vscode.window).activeTextEditor = mockEditor

			// Set up out-of-bounds position
			mockEditor.selection.active = new vscode.Position(100, 0)

			// Set animation to "wait" state so update() will call getPosition()
			animation.wait()

			// Reset the mock to track only the calls from the next update
			mockDocument.lineAt.mockClear()

			// This should not throw an error
			expect(() => {
				animation.update()
			}).not.toThrow()

			// Should have clamped to valid line
			expect(mockDocument.lineAt).toHaveBeenCalledWith(9) // lineCount - 1
		})
	})
})
