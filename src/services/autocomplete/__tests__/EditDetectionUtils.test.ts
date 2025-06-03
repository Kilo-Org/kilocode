import * as vscode from "vscode"
import { isHumanEdit } from "../utils/EditDetectionUtils"

// Mock the vscode namespace
jest.mock("vscode", () => ({
	TextDocumentChangeReason: {
		Undo: 1,
		Redo: 2,
	},
}))

describe("EditDetectionUtils", () => {
	describe("isHumanEdit", () => {
		// Helper to create a mock TextDocumentChangeEvent
		function createMockChangeEvent(
			contentChanges: Array<{ text: string; rangeLength: number }>,
			reason?: number,
		): vscode.TextDocumentChangeEvent {
			return {
				document: {} as vscode.TextDocument,
				contentChanges: contentChanges.map((change) => ({
					...change,
					range: {} as vscode.Range,
					rangeOffset: 0,
					rangeLengthDelta: 0,
				})),
				reason,
			} as vscode.TextDocumentChangeEvent
		}

		test("should return true for undo operations", () => {
			const event = createMockChangeEvent(
				[{ text: "some text", rangeLength: 0 }],
				vscode.TextDocumentChangeReason.Undo,
			)
			expect(isHumanEdit(event)).toBe(true)
		})

		test("should return true for redo operations", () => {
			const event = createMockChangeEvent(
				[{ text: "some text", rangeLength: 0 }],
				vscode.TextDocumentChangeReason.Redo,
			)
			expect(isHumanEdit(event)).toBe(true)
		})

		test("should return false for multiple changes in a single event", () => {
			const event = createMockChangeEvent([
				{ text: "change 1", rangeLength: 0 },
				{ text: "change 2", rangeLength: 0 },
			])
			expect(isHumanEdit(event)).toBe(false)
		})

		test("should return true for pure deletion operations", () => {
			const event = createMockChangeEvent([{ text: "", rangeLength: 150 }])
			expect(isHumanEdit(event)).toBe(true)
		})

		test("should return false for large text insertions", () => {
			const event = createMockChangeEvent([{ text: "a".repeat(101), rangeLength: 0 }])
			expect(isHumanEdit(event)).toBe(false)
		})

		test("should return false for multi-line pastes with substantial content", () => {
			const event = createMockChangeEvent([
				{
					text: "line 1\nline 2\nline 3\nline 4\n" + "a".repeat(30),
					rangeLength: 0,
				},
			])
			expect(isHumanEdit(event)).toBe(false)
		})

		test("should return false for structured code patterns", () => {
			const event = createMockChangeEvent([
				{
					text: "function example() {\n  const x = 1;\n  return x;\n}",
					rangeLength: 0,
				},
			])
			expect(isHumanEdit(event)).toBe(false)
		})

		test("should return true for small, simple text insertions", () => {
			const event = createMockChangeEvent([{ text: "simple text", rangeLength: 0 }])
			expect(isHumanEdit(event)).toBe(true)
		})
	})
})
