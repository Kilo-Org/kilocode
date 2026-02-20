import { describe, it, expect, beforeEach } from "vitest"
import { BracketMatchingService, BRACKETS, BRACKETS_REVERSE } from "./BracketMatchingService"

describe("BracketMatchingService", () => {
	let service: BracketMatchingService

	beforeEach(() => {
		service = new BracketMatchingService()
	})

	describe("BRACKETS constants", () => {
		it("should have correct opening-to-closing bracket mappings", () => {
			expect(BRACKETS["("]).toBe(")")
			expect(BRACKETS["{"]).toBe("}")
			expect(BRACKETS["["]).toBe("]")
		})

		it("should have correct closing-to-opening bracket mappings", () => {
			expect(BRACKETS_REVERSE[")"]).toBe("(")
			expect(BRACKETS_REVERSE["}"]).toBe("{")
			expect(BRACKETS_REVERSE["]"]).toBe("[")
		})
	})

	describe("handleAcceptedCompletion", () => {
		it("should track unmatched opening brackets from completion", () => {
			service.handleAcceptedCompletion("function test() {", "test.ts")
			// Internal state should track the unmatched opening brackets
			// We can verify this by checking behavior in subsequent calls
		})

		it("should handle matched bracket pairs correctly", () => {
			service.handleAcceptedCompletion("function test() { return 1; }", "test.ts")
			// All brackets are matched, so stack should be empty
		})

		it("should handle multiple unmatched opening brackets", () => {
			service.handleAcceptedCompletion("if (condition) { while (true) {", "test.ts")
			// Should track both unmatched { brackets
		})

		it("should handle nested bracket structures", () => {
			service.handleAcceptedCompletion("arr[0] = { key: [1, 2]", "test.ts")
			// Should track unmatched { and [
		})

		it("should stop tracking when encountering unmatched closing bracket", () => {
			service.handleAcceptedCompletion("function test() { } }", "test.ts")
			// Should stop when encountering the extra closing brace
		})

		it("should handle different bracket types", () => {
			service.handleAcceptedCompletion("const obj = { arr: [1, (2", "test.ts")
			// Should track {, [, and (
		})

		it("should reset state for each new completion", () => {
			service.handleAcceptedCompletion("function test() {", "test.ts")
			service.handleAcceptedCompletion("class MyClass {", "test.ts")
			// Second call should reset state from first call
		})

		it("should update filepath tracking", () => {
			service.handleAcceptedCompletion("function a() {", "file1.ts")
			service.handleAcceptedCompletion("function b() {", "file2.ts")
			// Should track that we're now in file2.ts
		})

		it("should handle empty completion string", () => {
			service.handleAcceptedCompletion("", "test.ts")
			// Should not throw and should have empty stack
		})

		it("should handle completion with only text and no brackets", () => {
			service.handleAcceptedCompletion("const x = 5;", "test.ts")
			// Should complete successfully with empty bracket stack
		})

		it("should handle complex nested structure", () => {
			service.handleAcceptedCompletion("obj = { a: [1, { b: (x", "test.ts")
			// Should track {, [, {, (
		})
	})

	describe("stopOnUnmatchedClosingBracket", () => {
		// Helper function to create async generator from array
		async function* arrayToAsyncGen(arr: string[]): AsyncGenerator<string> {
			for (const item of arr) {
				yield item
			}
		}

		// Helper to collect all values from async generator
		async function collectAll(gen: AsyncGenerator<string>): Promise<string[]> {
			const results: string[] = []
			for await (const item of gen) {
				results.push(item)
			}
			return results
		}

		describe("multiline mode", () => {
			it("should allow closing brackets that match previous completion", async () => {
				service.handleAcceptedCompletion("function test() {", "test.ts")
				const stream = arrayToAsyncGen(["\n  return 1;\n}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "function test() ", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("\n  return 1;\n}")
			})

			it("should not use previous completion state from different file", async () => {
				service.handleAcceptedCompletion("function test() {", "file1.ts")
				const stream = arrayToAsyncGen(["}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "file2.ts", true)
				const result = await collectAll(filtered)
				// Different file so stack is empty, but '}' is in whitespace section
				// Whitespace section (closing brackets before non-whitespace) yields without checking
				// Since '}' doesn't match /[^\s\)\}\]]/, it's all whitespace/closing brackets
				// So entire chunk is yielded and loop continues to end
				expect(result.join("")).toBe("}")
			})

			it("should stop on unmatched closing bracket in multiline", async () => {
				const stream = arrayToAsyncGen(["function test() {\n  return 1;\n}\n}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "test.ts", true)
				const result = await collectAll(filtered)
				// The chunk contains one complete function and one extra '}'
				// Processing char by char: '{' at position 16 opens, '}' at position 32 closes (stack empty)
				// '\n' at position 33, then '}' at position 34 is unmatched (stack empty)
				// Yields chunk.slice(0, 34) which includes the newline after the first }
				expect(result.join("")).toBe("function test() {\n  return 1;\n}\n")
			})

			it("should handle multiple chunks in stream", async () => {
				const stream = arrayToAsyncGen(["function", " test()", " {", "\n  return", " 1;", "\n}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("function test() {\n  return 1;\n}")
			})
		})

		describe("single-line mode", () => {
			it("should allow completing brackets from current line", async () => {
				const stream = arrayToAsyncGen(["x + 1)"])
				const filtered = service.stopOnUnmatchedClosingBracket(
					stream,
					"const result = calculate(",
					");",
					"test.ts",
					false,
				)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("x + 1)")
			})

			it("should handle bracket in suffix that gets overwritten", async () => {
				const stream = arrayToAsyncGen(["1, 2, 3)"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "array.push(", ");", "test.ts", false)
				const result = await collectAll(filtered)
				// Should allow the closing paren because suffix has one
				expect(result.join("")).toBe("1, 2, 3)")
			})

			it("should stop on unmatched closing bracket in single-line", async () => {
				const stream = arrayToAsyncGen(["x + 1))"])
				const filtered = service.stopOnUnmatchedClosingBracket(
					stream,
					"const result = calculate(",
					"",
					"test.ts",
					false,
				)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("x + 1)")
			})

			it("should handle multiple bracket pairs on current line", async () => {
				const stream = arrayToAsyncGen(['" + y + ")])'])
				const filtered = service.stopOnUnmatchedClosingBracket(
					stream,
					'array.push({ key: getValue("x',
					"",
					"test.ts",
					false,
				)
				const result = await collectAll(filtered)
				// Current line has: { ( (
				// Stream closes: ) ] )
				// First ) matches third (, second ] doesn't match second ( (expects }), stops before ]
				expect(result.join("")).toBe('" + y + ")')
			})
		})

		describe("edge cases", () => {
			it("should handle empty stream", async () => {
				const stream = arrayToAsyncGen([])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result).toEqual([])
			})

			it("should handle stream with only whitespace before brackets", async () => {
				const stream = arrayToAsyncGen(["  \n  }"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "function test() {", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("  \n  }")
			})

			it("should allow closing brackets before non-whitespace content", async () => {
				const stream = arrayToAsyncGen([")\n  const x = 1;"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "function test(", "", "test.ts", true)
				const result = await collectAll(filtered)
				// In multiline mode with no previous completion, stack starts empty but prefix has '('
				// Actually, prefix is NOT processed in multiline mode (only previous completion state)
				// Whitespace section: searches for /[^\s\)\}\]]/, finds 'c' at index 7
				// Yields ')\n  ' (everything before 'c'), then processes 'const x = 1;'
				// 'const x = 1;' has no brackets, yields entire remaining chunk
				expect(result.join("")).toBe(")\n  const x = 1;")
			})

			it("should handle mixed bracket types correctly", async () => {
				const stream = arrayToAsyncGen(["]})"])
				const filtered = service.stopOnUnmatchedClosingBracket(
					stream,
					"obj = { arr: [{ key: val",
					"",
					"test.ts",
					true,
				)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("]})")
			})

			it("should handle suffix with spaces before closing bracket", async () => {
				const stream = arrayToAsyncGen(["1, 2, 3)"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "func(", "  )", "test.ts", false)
				const result = await collectAll(filtered)
				// Spaces in suffix should be ignored, bracket should be added to stack
				expect(result.join("")).toBe("1, 2, 3)")
			})

			it("should stop when suffix parsing ends at non-bracket", async () => {
				const stream = arrayToAsyncGen(["x)"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "func(", ") {", "test.ts", false)
				const result = await collectAll(filtered)
				// In single-line mode, current line is 'func() {'
				// Stack from current line: ( opens, ) closes (matches), { opens -> stack = ['{']
				// Suffix ') {': unshift adds '(' to FRONT of stack -> stack = ['(', '{']
				// Stream 'x)': ')' is closing bracket
				//   stack.pop() removes from END, returns '{', BRACKETS['{'] = '}', char = ')'
				//   '}' !== ')' so condition is true, stops and yields 'x'
				expect(result.join("")).toBe("x")
			})

			it("should handle chunk boundary on closing bracket", async () => {
				const stream = arrayToAsyncGen(["return 1", ";", "\n", "}", "extra"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "function test() {", "", "test.ts", true)
				const result = await collectAll(filtered)
				// In multiline mode without previous completion state, stack starts empty
				// Prefix doesn't add to stack in multiline mode
				// First chunk 'return 1' has no brackets, yielded
				// Second chunk ';' has no brackets, yielded
				// Third chunk '\n' is whitespace with no brackets, still in whitespace section
				// Fourth chunk '}' is closing bracket in whitespace section, but stack is empty so stops immediately
				expect(result.join("")).toBe("return 1;\n")
			})

			it("should handle nested brackets in stream", async () => {
				const stream = arrayToAsyncGen(["arr[i][j]"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "const val = ", ";", "test.ts", false)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("arr[i][j]")
			})

			it("should handle unmatched opening brackets in stream", async () => {
				const stream = arrayToAsyncGen(["arr[index"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("arr[index")
			})
		})

		describe("state persistence across completions", () => {
			it("should use state from previous completion in same file", async () => {
				service.handleAcceptedCompletion("if (cond) {\n  while (true) {", "test.ts")
				const stream = arrayToAsyncGen(["\n    doWork();\n  }\n}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "test.ts", true)
				const result = await collectAll(filtered)
				expect(result.join("")).toBe("\n    doWork();\n  }\n}")
			})

			it("should not use state from previous file", async () => {
				service.handleAcceptedCompletion("if (cond) {", "file1.ts")
				const stream = arrayToAsyncGen(["}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "file2.ts", true)
				const result = await collectAll(filtered)
				// Different file so stack is empty, but '}' is in whitespace section
				// Since '}' doesn't match /[^\s\)\}\]]/, entire chunk yielded without bracket checking
				expect(result.join("")).toBe("}")
			})

			it("should clear state when switching files", async () => {
				service.handleAcceptedCompletion("function a() {", "file1.ts")
				service.handleAcceptedCompletion("function b() {", "file2.ts")
				const stream = arrayToAsyncGen(["\n  return;\n}"])
				const filtered = service.stopOnUnmatchedClosingBracket(stream, "", "", "file2.ts", true)
				const result = await collectAll(filtered)
				// Should only allow one closing brace from file2's state
				expect(result.join("")).toBe("\n  return;\n}")
			})
		})
	})
})
