import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { GhostCursor } from "../GhostCursor"
import { GhostSuggestionsState } from "../GhostSuggestions"

// Mock VSCode API
vi.mock("vscode", () => ({
	window: {
		activeTextEditor: null,
	},
	Selection: vi.fn(),
	Range: vi.fn(),
	Position: vi.fn(),
	TextEditorRevealType: {
		InCenter: 1,
	},
	Uri: {
		file: vi.fn(),
	},
}))

describe("GhostCursor", () => {
	let ghostCursor: GhostCursor
	let mockEditor: any
	let mockDocument: any
	let mockSuggestions: any
	let mockSuggestionsFile: any

	beforeEach(() => {
		ghostCursor = new GhostCursor()

		mockDocument = {
			uri: { toString: () => "file:///test.js" },
			lineAt: vi.fn(),
			lineCount: 10, // Document has 10 lines (0-9)
		}

		mockEditor = {
			document: mockDocument,
			selection: null,
			revealRange: vi.fn(),
		}

		mockSuggestionsFile = {
			getGroupsOperations: vi.fn(),
			getSelectedGroup: vi.fn(),
			getGroupType: vi.fn(),
		}

		mockSuggestions = {
			getFile: vi.fn().mockReturnValue(mockSuggestionsFile),
		}

		// Reset VSCode window mock
		vi.mocked(vscode.window).activeTextEditor = mockEditor

		// Mock VSCode Position objects with all required methods
		const createPosition = (line: number, character: number) => ({
			line,
			character,
			isBefore: vi.fn(),
			isBeforeOrEqual: vi.fn(),
			isAfter: vi.fn(),
			isAfterOrEqual: vi.fn(),
			isEqual: vi.fn(),
			compareTo: vi.fn(),
			translate: vi.fn(),
			with: vi.fn(),
		})

		vi.mocked(vscode.Selection).mockImplementation((a, b, c, d) => ({
			start: createPosition(a, b),
			end: createPosition(c, d),
			anchor: createPosition(a, b),
			active: createPosition(c, d),
			isEmpty: false,
			isSingleLine: a === c,
			isReversed: false,
			contains: vi.fn(),
			isEqual: vi.fn(),
			intersection: vi.fn(),
			union: vi.fn(),
			with: vi.fn(),
		}))
		vi.mocked(vscode.Range).mockImplementation((a, b, c, d) => ({
			start: createPosition(a, b),
			end: createPosition(c, d),
			isEmpty: false,
			isSingleLine: a === c,
			contains: vi.fn(),
			isEqual: vi.fn(),
			intersection: vi.fn(),
			union: vi.fn(),
			with: vi.fn(),
		}))
	})

	describe("moveToAppliedGroup", () => {
		it("should handle negative line numbers gracefully", () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				[{ oldLine: -5 }], // Invalid negative line
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)
			mockSuggestionsFile.getGroupType.mockReturnValue("-")

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleWarnSpy).toHaveBeenCalledWith("Invalid line number: -5, must be >= 0")
			expect(mockDocument.lineAt).not.toHaveBeenCalled()
			expect(mockEditor.revealRange).not.toHaveBeenCalled()

			consoleWarnSpy.mockRestore()
		})

		it("should handle line numbers exceeding document bounds", () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			mockDocument.lineAt.mockReturnValue({ text: "test content" })

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				[{ oldLine: 15 }], // Line 15 exceeds document's 10 lines
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)
			mockSuggestionsFile.getGroupType.mockReturnValue("-")

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleWarnSpy).toHaveBeenCalledWith("Line number 15 exceeds document line count 10")
			// Should clamp to last line (line 9)
			expect(mockDocument.lineAt).toHaveBeenCalledWith(9)
			expect(mockEditor.revealRange).toHaveBeenCalled()

			consoleWarnSpy.mockRestore()
		})

		it("should handle infinity values from empty groups", () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				[], // Empty group would cause Math.min to return Infinity
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleLogSpy).toHaveBeenCalledWith("Group is empty, returning")
			expect(mockDocument.lineAt).not.toHaveBeenCalled()

			consoleLogSpy.mockRestore()
		})

		it("should handle valid line numbers correctly", () => {
			mockDocument.lineAt.mockReturnValue({ text: "test content", length: 12 })

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				[{ oldLine: 5 }, { oldLine: 6 }], // Valid lines
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)
			mockSuggestionsFile.getGroupType.mockReturnValue("-")

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(mockDocument.lineAt).toHaveBeenCalledWith(5) // Math.min of [5, 6]
			expect(mockEditor.revealRange).toHaveBeenCalled()
		})

		it("should handle addition groups with proper line calculation", () => {
			mockDocument.lineAt.mockReturnValue({ text: "test content", length: 12 })

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				[{ oldLine: 5 }, { oldLine: 6 }], // 2 operations starting at line 5
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)
			mockSuggestionsFile.getGroupType.mockReturnValue("+")

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			// For additions: Math.min([5, 6]) + group.length = 5 + 2 = 7
			expect(mockDocument.lineAt).toHaveBeenCalledWith(7)
			expect(mockEditor.revealRange).toHaveBeenCalled()
		})

		it("should handle addition groups that exceed bounds after calculation", () => {
			const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
			mockDocument.lineAt.mockReturnValue({ text: "test content", length: 12 })

			mockSuggestionsFile.getGroupsOperations.mockReturnValue([
				Array(10).fill({ oldLine: 8 }), // 10 operations at line 8: 8 + 10 = 18 > 10 lines
			])
			mockSuggestionsFile.getSelectedGroup.mockReturnValue(0)
			mockSuggestionsFile.getGroupType.mockReturnValue("+")

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleWarnSpy).toHaveBeenCalledWith("Line number 18 exceeds document line count 10")
			// Should clamp to last valid line (9)
			expect(mockDocument.lineAt).toHaveBeenCalledWith(9)

			consoleWarnSpy.mockRestore()
		})

		it("should return early when no active editor", () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			vi.mocked(vscode.window).activeTextEditor = undefined

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleLogSpy).toHaveBeenCalledWith("No active editor found, returning")
			expect(mockSuggestions.getFile).not.toHaveBeenCalled()

			consoleLogSpy.mockRestore()
		})

		it("should return early when no suggestions file found", () => {
			const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {})
			mockSuggestions.getFile.mockReturnValue(null)

			ghostCursor.moveToAppliedGroup(mockSuggestions)

			expect(consoleLogSpy).toHaveBeenCalledWith("No suggestions found for document: file:///test.js")

			consoleLogSpy.mockRestore()
		})
	})
})
