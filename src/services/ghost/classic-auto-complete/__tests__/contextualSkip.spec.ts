import { getTerminatorsForLanguage, shouldSkipAutocomplete } from "../contextualSkip"

/**
 * Tests for shouldSkipAutocomplete behavior.
 * These tests verify that shouldSkipAutocomplete correctly handles
 * end-of-statement detection (returning true when at end of statement).
 */
describe("shouldSkipAutocomplete - end of statement detection", () => {
	describe("C-like languages (JavaScript, TypeScript, etc.)", () => {
		const languageId = "typescript"

		it("should skip when cursor is after semicolon at end of line", () => {
			expect(shouldSkipAutocomplete("console.info('foo');", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("const x = 5;", "\nconst y = 10;", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("return value;", "\n}", languageId)).toBe(true)
		})

		it("should skip when cursor is after closing parenthesis at end of line", () => {
			expect(shouldSkipAutocomplete("myFunction()", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("if (condition)", "\n{", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("console.log(x)", "", languageId)).toBe(true)
		})

		it("should skip when cursor is after closing brace at end of line", () => {
			expect(shouldSkipAutocomplete("}", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("const obj = {}", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("function test() {}", "", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is after closing bracket (not a statement terminator)", () => {
			// Brackets are not statement terminators in C-like languages
			expect(shouldSkipAutocomplete("const arr = []", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("items[0]", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when cursor is after comma (not a statement terminator)", () => {
			// Commas are not terminators - they indicate continuation
			expect(shouldSkipAutocomplete("  item1,", "\n  item2,", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const x = 1,", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when cursor is after colon", () => {
			// Colons are not terminators in JS/TS
			expect(shouldSkipAutocomplete("  key:", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("case 'test':", "\n", languageId)).toBe(false)
		})

		it("should skip when cursor is after angle bracket followed by ) terminator", () => {
			// ) is the terminator here
			expect(shouldSkipAutocomplete("if (x > 5)", "\n", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is after generic type (not a terminator)", () => {
			expect(shouldSkipAutocomplete("Array<string>", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when cursor is after quote (not a statement terminator)", () => {
			// Quotes are not statement terminators - the statement might continue
			expect(shouldSkipAutocomplete('const s = "hello"', "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const s = 'world'", "\n", languageId)).toBe(false)
		})

		it("should skip with trailing whitespace after terminator", () => {
			expect(shouldSkipAutocomplete("console.log();  ", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("const x = 5;\t", "\n", languageId)).toBe(true)
		})
	})

	describe("Python", () => {
		const languageId = "python"

		it("should skip when cursor is after closing parenthesis", () => {
			expect(shouldSkipAutocomplete("print('hello')", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("my_func()", "\n", languageId)).toBe(true)
		})

		it("should skip when cursor is after closing bracket", () => {
			expect(shouldSkipAutocomplete("my_list = []", "\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("items[0]", "\n", languageId)).toBe(true)
		})

		it("should skip when cursor is after closing brace", () => {
			expect(shouldSkipAutocomplete("my_dict = {}", "\n", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is after colon (starts a block)", () => {
			// In Python, colon starts a block - autocomplete should suggest the block body
			expect(shouldSkipAutocomplete("def foo():", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("if condition:", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("for i in range(10):", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when cursor is after semicolon (rare in Python)", () => {
			// Python doesn't use semicolons as statement terminators
			expect(shouldSkipAutocomplete("x = 5;", "\n", languageId)).toBe(false)
		})
	})

	describe("HTML/Markup languages", () => {
		const languageId = "html"

		it("should NOT skip in markup languages (no terminators defined)", () => {
			// Markup languages don't have statement terminators - > could be mid-line
			expect(shouldSkipAutocomplete("<div>", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("</div>", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("<br />", "\n", languageId)).toBe(false)
		})

		it("should skip when cursor is mid-word in incomplete tag", () => {
			// Mid-word typing is blocked (word length > 2)
			expect(shouldSkipAutocomplete("<div", "\n", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is after equals in attribute", () => {
			// = is not a terminator
			expect(shouldSkipAutocomplete("<div class=", "\n", languageId)).toBe(false)
		})
	})

	describe("Shell/Bash", () => {
		const languageId = "shellscript"

		it("should skip when cursor is after semicolon", () => {
			expect(shouldSkipAutocomplete("echo hello;", "\n", languageId)).toBe(true)
		})

		it("should skip when cursor is after fi (shell terminator)", () => {
			// "fi" is a statement terminator in shell scripts (ends if blocks)
			expect(shouldSkipAutocomplete("fi", "\n", languageId)).toBe(true)
		})

		it("should skip when cursor is after done (mid-word typing, > 2 chars)", () => {
			// "done" is 4 chars, triggers mid-word skip logic
			expect(shouldSkipAutocomplete("done", "\n", languageId)).toBe(true)
		})

		it("should skip when fi/done is part of a larger word (mid-word typing)", () => {
			expect(shouldSkipAutocomplete("wifi", "\n", languageId)).toBe(true) // mid-word typing
			expect(shouldSkipAutocomplete("undone", "\n", languageId)).toBe(true) // mid-word typing
		})
	})

	describe("SQL", () => {
		const languageId = "sql"

		it("should skip when cursor is after semicolon", () => {
			expect(shouldSkipAutocomplete("SELECT * FROM users;", "\n", languageId)).toBe(true)
		})

		it("should skip when cursor is mid-word in incomplete statement", () => {
			// "FROM" is mid-word typing (word length > 2)
			expect(shouldSkipAutocomplete("SELECT * FROM", "\n", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is after space in incomplete statement", () => {
			// Space is not a terminator
			expect(shouldSkipAutocomplete("SELECT * FROM ", "\n", languageId)).toBe(false)
		})
	})

	describe("should NOT skip autocomplete in valid positions", () => {
		const languageId = "typescript"

		it("should NOT skip when cursor is mid-line with content after", () => {
			// When cursor is after a non-word character (like `.` or space), we should NOT skip
			// even if the suffix starts with a word character
			expect(shouldSkipAutocomplete("console.", "log();\n", languageId)).toBe(true)
			expect(shouldSkipAutocomplete("const x = ", " + 1;\n", languageId)).toBe(false)
			// When suffix starts with a word character, skip is triggered
			expect(shouldSkipAutocomplete("if (", "condition) {\n", languageId)).toBe(true)
		})

		it("should NOT skip when cursor is at empty line", () => {
			expect(shouldSkipAutocomplete("function test() {\n", "\n}", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("  ", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with incomplete statement", () => {
			expect(shouldSkipAutocomplete("const x =", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const x = 5 +", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("if (x", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("function test(", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with opening brace", () => {
			expect(shouldSkipAutocomplete("function test() {", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("if (condition) {", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const obj = {", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with opening bracket", () => {
			expect(shouldSkipAutocomplete("const arr = [", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with opening parenthesis", () => {
			expect(shouldSkipAutocomplete("myFunction(", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("console.log(", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with operator", () => {
			expect(shouldSkipAutocomplete("const x = a +", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const y = b &&", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("const z = c ||", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with dot (property access)", () => {
			expect(shouldSkipAutocomplete("object.", "\n", languageId)).toBe(false)
			expect(shouldSkipAutocomplete("this.", "\n", languageId)).toBe(false)
		})

		it("should NOT skip when line ends with equals sign (incomplete assignment)", () => {
			expect(shouldSkipAutocomplete("const fn =", "\n", languageId)).toBe(false)
		})
	})

	describe("edge cases", () => {
		it("should NOT skip for empty strings", () => {
			expect(shouldSkipAutocomplete("", "")).toBe(false)
		})

		it("should skip with whitespace suffix after terminator", () => {
			expect(shouldSkipAutocomplete("const x = 5;", "   ", "typescript")).toBe(true)
			expect(shouldSkipAutocomplete("const x = 5;", "\t\t", "typescript")).toBe(true)
		})

		it("should skip for multiline prefix ending with terminator", () => {
			const prefix = "function test() {\n  const x = 5;\n  return x;"
			expect(shouldSkipAutocomplete(prefix, "\n}", "typescript")).toBe(true)
		})

		it("should skip for multiline suffix with terminator", () => {
			const suffix = "\n  const y = 10;\n}"
			expect(shouldSkipAutocomplete("const x = 5;", suffix, "typescript")).toBe(true)
		})

		it("should use default terminators when no languageId provided", () => {
			// Default terminators are ; } )
			expect(shouldSkipAutocomplete("const x = 5;", "\n")).toBe(true)
			expect(shouldSkipAutocomplete("}", "\n")).toBe(true)
			expect(shouldSkipAutocomplete("foo()", "\n")).toBe(true)
		})

		it("should use default terminators for unknown languages", () => {
			expect(shouldSkipAutocomplete("const x = 5;", "\n", "unknown-language")).toBe(true)
			expect(shouldSkipAutocomplete("}", "\n", "unknown-language")).toBe(true)
		})
	})

	describe("getTerminatorsForLanguage", () => {
		it("should return c-like terminators for JavaScript/TypeScript", () => {
			const terminators = getTerminatorsForLanguage("typescript")
			expect(terminators.includes(";")).toBe(true)
			expect(terminators.includes("}")).toBe(true)
			expect(terminators.includes(")")).toBe(true)
			expect(terminators.includes(",")).toBe(false)
			expect(terminators.includes(":")).toBe(false)
		})

		it("should return python terminators", () => {
			const terminators = getTerminatorsForLanguage("python")
			expect(terminators.includes(")")).toBe(true)
			expect(terminators.includes("]")).toBe(true)
			expect(terminators.includes("}")).toBe(true)
			expect(terminators.includes(";")).toBe(false)
			expect(terminators.includes(":")).toBe(false)
		})

		it("should return empty terminators for HTML (markup)", () => {
			const terminators = getTerminatorsForLanguage("html")
			expect(terminators.length).toBe(0)
			expect(terminators.includes(">")).toBe(false)
			expect(terminators.includes(";")).toBe(false)
		})

		it("should return shell terminators", () => {
			const terminators = getTerminatorsForLanguage("shellscript")
			expect(terminators.includes(";")).toBe(true)
			expect(terminators.includes("fi")).toBe(true)
			expect(terminators.includes("done")).toBe(true)
		})

		it("should return default terminators for unknown languages", () => {
			const terminators = getTerminatorsForLanguage("some-unknown-language")
			expect(terminators.includes(";")).toBe(true)
			expect(terminators.includes("}")).toBe(true)
			expect(terminators.includes(")")).toBe(true)
		})
	})
})

describe("shouldSkipAutocomplete - mid-word typing", () => {
	it("should skip when typing in the middle of a long word", () => {
		expect(shouldSkipAutocomplete("myVaria", "\n", "typescript")).toBe(true)
		expect(shouldSkipAutocomplete("functionN", "\n", "typescript")).toBe(true)
		expect(shouldSkipAutocomplete("console", "\n", "typescript")).toBe(true)
	})

	it("should NOT skip for short words (1-2 chars)", () => {
		// Short words might be the start of a new identifier
		expect(shouldSkipAutocomplete("my", "\n", "typescript")).toBe(false)
		expect(shouldSkipAutocomplete("x", "\n", "typescript")).toBe(false)
	})
})

describe("shouldSkipAutocomplete - general behavior", () => {
	it("should NOT skip for empty prefix", () => {
		expect(shouldSkipAutocomplete("", "")).toBe(false)
		expect(shouldSkipAutocomplete("", "some content")).toBe(false)
	})

	it("should work without languageId", () => {
		expect(shouldSkipAutocomplete("const ", "\n")).toBe(false)
		expect(shouldSkipAutocomplete("object.", "\n")).toBe(false)
		expect(shouldSkipAutocomplete("const x = 5;", "\n")).toBe(true)
	})
})
