import "./autocompleteTestSetup"
import * as vscode from "vscode"
import { processTextInsertion, InsertionContext } from "../utils/CompletionTextProcessor"
import { MockTextEditor } from "./MockTextEditor"

describe("CompletionTextProcessor", () => {
	test("should trim beginning when first line of completion starts with existing text", () => {
		const completionText = "const x = 1 + 2;\nconsole.log(x);"
		const { document, cursorPosition } = MockTextEditor.create("const x = ␣")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("1 + 2;\nconsole.log(x);")
	})

	test("should trim end when last line of completion matches existing text", () => {
		const completionText = "function add(a, b) {\n  return a + b;\n}"
		const { document, cursorPosition } = MockTextEditor.create("function add(a, b) {␣\n}")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("\n  return a + b;") // only the non-overlapping part
	})

	test("should trim both beginning and end when both match", () => {
		const completionText = "if (condition) {\n  doSomething();\n}"
		const { document, cursorPosition } = MockTextEditor.create("if (condition) {␣\n}")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("\n  doSomething();") // only the non-overlapping part
	})

	test("should return null when completion text is completely contained in existing text", () => {
		const completionText = "const x = 1;"
		const { document, cursorPosition } = MockTextEditor.create("const x = 1;␣")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result).toBeNull()
	})

	test("should return original completion when there's no overlap", () => {
		const completionText = "const y = 2;"
		const { document, cursorPosition } = MockTextEditor.create("const x = 1;␣")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("const y = 2;")
	})

	test("should handle the example case from the code", () => {
		const completionText = "a + b\n}"
		const { document, cursorPosition } = MockTextEditor.create("a + ␣")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("b\n}")
	})

	test("should handle auto-closing parenthesis", () => {
		const completionText = "a, b) {\n  return a + b\n}"
		const { document, cursorPosition } = MockTextEditor.create(`function sum(␣)`)

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("a, b) {\n  return a + b\n}")
		expect(result?.insertRange).toEqual(new vscode.Range(cursorPosition, cursorPosition.translate(0, 1)))
	})

	test("should handle the case where closing brace already exists", () => {
		const completionText = "a + b\n}"
		const { document, cursorPosition } = MockTextEditor.create("a + ␣\n}")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("b")
	})

	test("should handle common prefix with different suffixes", () => {
		const completionText = "export function calculateSum(a: number, b: number)\n  return a + b;"
		const { document, cursorPosition } = MockTextEditor.create("export function calculate␣): number {")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		// Should find the common prefix "export function calculate" and only return the remaining part
		expect(result?.processedText).toBe("Sum(a: number, b: number)\n  return a + b;")
	})

	test("should provide modification information", () => {
		const completionText = "const x = 1 + 2;\nconsole.log(x);"
		const { document, cursorPosition } = MockTextEditor.create("const x = ␣")

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.modifications).toEqual({
			prefixTrimmed: 10, // "const x = " plus trailing space
			suffixTrimmed: 0,
			originalLength: completionText.length,
		})
	})

	test("should handle whitespace before completion text", () => {
		const completionText = "return a + b"
		const { document, cursorPosition } = MockTextEditor.create(
			`\
function sum(a:number, b:number): number {
  return ␣
}`,
		)

		const result = processTextInsertion({ document, position: cursorPosition, textToInsert: completionText })
		expect(result?.processedText).toBe("a + b")
	})
})
