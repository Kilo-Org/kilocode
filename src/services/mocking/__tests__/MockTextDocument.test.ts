import { describe, it, expect, vi, beforeEach } from "vitest"
import * as vscode from "vscode"
import { MockTextDocument } from "../MockTextDocument"

vi.mock("vscode", () => ({
	EndOfLine: { LF: 1, CRLF: 2 },
	Uri: {
		parse: vi.fn((str) => ({
			fsPath: str,
			path: str,
			scheme: "file",
		})),
	},
	Position: class Position {
		constructor(
			public line: number,
			public character: number,
		) {}
	},
	Range: class Range {
		constructor(
			public start: vscode.Position,
			public end: vscode.Position,
		) {}
	},
}))

describe("MockTextDocument", () => {
	const testUri = vscode.Uri.parse("file:///test.ts")

	describe("constructor and basic properties", () => {
		it("should create document from single line content", () => {
			const doc = new MockTextDocument(testUri, "const x = 1")

			expect(doc.lineCount).toBe(1)
			expect(doc.getText()).toBe("const x = 1")
		})

		it("should create document from multi-line content", () => {
			const content = "function test() {\n    return true\n}"
			const doc = new MockTextDocument(testUri, content)

			expect(doc.lineCount).toBe(3)
			expect(doc.getText()).toBe(content)
		})

		it("should handle empty content", () => {
			const doc = new MockTextDocument(testUri, "")

			expect(doc.lineCount).toBe(1)
			expect(doc.getText()).toBe("")
		})

		it("should handle content with only newlines", () => {
			const doc = new MockTextDocument(testUri, "\n\n\n")

			expect(doc.lineCount).toBe(4)
			expect(doc.getText()).toBe("\n\n\n")
		})
	})

	describe("getText() method", () => {
		const multiLineContent = "line 1\nline 2\nline 3\nline 4"
		let doc: MockTextDocument

		beforeEach(() => {
			doc = new MockTextDocument(testUri, multiLineContent)
		})

		it("should return full text when no range provided", () => {
			expect(doc.getText()).toBe(multiLineContent)
		})

		it("should return text within single line range", () => {
			const range = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(1, 5))

			expect(doc.getText(range)).toBe("ne ")
		})

		it("should return text from start of line to position", () => {
			const range = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 4))

			expect(doc.getText(range)).toBe("line")
		})

		it("should return text from position to end of line", () => {
			const range = new vscode.Range(new vscode.Position(1, 5), new vscode.Position(1, 6))

			expect(doc.getText(range)).toBe("2")
		})

		it("should return text across multiple lines", () => {
			const range = new vscode.Range(new vscode.Position(1, 2), new vscode.Position(3, 2))

			expect(doc.getText(range)).toBe("ne 2\nline 3\nli")
		})

		it("should handle range starting from middle of first line", () => {
			const range = new vscode.Range(new vscode.Position(0, 2), new vscode.Position(2, 4))

			expect(doc.getText(range)).toBe("ne 1\nline 2\nline")
		})

		it("should handle range ending in middle of last line", () => {
			const range = new vscode.Range(new vscode.Position(1, 0), new vscode.Position(2, 4))

			expect(doc.getText(range)).toBe("line 2\nline")
		})

		it("should handle range beyond document bounds gracefully", () => {
			const range = new vscode.Range(new vscode.Position(2, 0), new vscode.Position(10, 10))

			expect(doc.getText(range)).toBe("line 3\nline 4")
		})
	})

	describe("lineAt() method", () => {
		const content = "  const x = 1\n\n    function test() {\n        return x\n    }"
		let doc: MockTextDocument

		beforeEach(() => {
			doc = new MockTextDocument(testUri, content)
		})

		it("should return correct line information for first line", () => {
			const line = doc.lineAt(0)

			expect(line.text).toBe("  const x = 1")
			expect(line.lineNumber).toBe(0)
			expect(line.firstNonWhitespaceCharacterIndex).toBe(2)
			expect(line.isEmptyOrWhitespace).toBe(false)
		})

		it("should return correct line information for empty line", () => {
			const line = doc.lineAt(1)

			expect(line.text).toBe("")
			expect(line.lineNumber).toBe(1)
			expect(line.firstNonWhitespaceCharacterIndex).toBe(0)
			expect(line.isEmptyOrWhitespace).toBe(true)
		})

		it("should return correct line information for whitespace-only line", () => {
			const docWithWhitespace = new MockTextDocument(testUri, "line1\n    \nline3")
			const line = docWithWhitespace.lineAt(1)

			expect(line.text).toBe("    ")
			expect(line.lineNumber).toBe(1)
			expect(line.firstNonWhitespaceCharacterIndex).toBe(4)
			expect(line.isEmptyOrWhitespace).toBe(true)
		})

		it("should return correct line information for indented line", () => {
			const line = doc.lineAt(2)

			expect(line.text).toBe("    function test() {")
			expect(line.lineNumber).toBe(2)
			expect(line.firstNonWhitespaceCharacterIndex).toBe(4)
			expect(line.isEmptyOrWhitespace).toBe(false)
		})

		it("should include correct range information", () => {
			const line = doc.lineAt(0)

			expect(line.range.start.line).toBe(0)
			expect(line.range.start.character).toBe(0)
			expect(line.range.end.line).toBe(0)
			expect(line.range.end.character).toBe(13) // Length of "  const x = 1"
		})

		it("should throw error for invalid line number (negative)", () => {
			expect(() => doc.lineAt(-1)).toThrow("Invalid line number: -1")
		})

		it("should throw error for invalid line number (beyond bounds)", () => {
			expect(() => doc.lineAt(10)).toThrow("Invalid line number: 10")
		})
	})

	describe("edge cases and special characters", () => {
		it("should handle tabs correctly", () => {
			const doc = new MockTextDocument(testUri, "\tfunction test() {\n\t\treturn true\n\t}")

			expect(doc.lineCount).toBe(3)

			const line0 = doc.lineAt(0)
			expect(line0.text).toBe("\tfunction test() {")
			expect(line0.firstNonWhitespaceCharacterIndex).toBe(1)

			const line1 = doc.lineAt(1)
			expect(line1.text).toBe("\t\treturn true")
			expect(line1.firstNonWhitespaceCharacterIndex).toBe(2)
		})

		it("should handle mixed whitespace", () => {
			const doc = new MockTextDocument(testUri, "  \t  const x = 1")
			const line = doc.lineAt(0)

			expect(line.text).toBe("  \t  const x = 1")
			expect(line.firstNonWhitespaceCharacterIndex).toBe(5)
			expect(line.isEmptyOrWhitespace).toBe(false)
		})

		it("should handle unicode characters", () => {
			const doc = new MockTextDocument(testUri, "const 🚀 = 'rocket'\nconst 中文 = 'chinese'")

			expect(doc.lineCount).toBe(2)
			expect(doc.lineAt(0).text).toBe("const 🚀 = 'rocket'")
			expect(doc.lineAt(1).text).toBe("const 中文 = 'chinese'")
		})

		it("should handle Windows line endings (CRLF)", () => {
			const doc = new MockTextDocument(testUri, "line1\r\nline2\r\nline3")

			// Note: split("\n") will still work but will include \r in the text
			expect(doc.lineCount).toBe(3)
			expect(doc.lineAt(0).text).toBe("line1\r")
			expect(doc.lineAt(1).text).toBe("line2\r")
			expect(doc.lineAt(2).text).toBe("line3")
		})
	})

	describe("integration with vscode types", () => {
		it("should work with vscode.Range for getText", () => {
			const doc = new MockTextDocument(testUri, "function test() {\n    return 42\n}")

			// Create a range using vscode constructors
			const start = new vscode.Position(0, 9)
			const end = new vscode.Position(1, 11)
			const range = new vscode.Range(start, end)

			expect(doc.getText(range)).toBe("test() {\n    return ")
		})

		it("should return TextLine compatible with vscode interface", () => {
			const doc = new MockTextDocument(testUri, "    const value = 'test'")
			const line = doc.lineAt(0)

			// Verify it has all required TextLine properties
			expect(line).toHaveProperty("text")
			expect(line).toHaveProperty("range")
			expect(line).toHaveProperty("lineNumber")
			expect(line).toHaveProperty("rangeIncludingLineBreak")
			expect(line).toHaveProperty("firstNonWhitespaceCharacterIndex")
			expect(line).toHaveProperty("isEmptyOrWhitespace")

			// Verify types match vscode expectations
			expect(typeof line.text).toBe("string")
			expect(typeof line.lineNumber).toBe("number")
			expect(typeof line.firstNonWhitespaceCharacterIndex).toBe("number")
			expect(typeof line.isEmptyOrWhitespace).toBe("boolean")
			expect(line.range).toBeInstanceOf(vscode.Range)
		})
	})
})
