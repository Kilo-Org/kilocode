// kilocode_change new file

import {
	protectNewlinesInQuotes,
	restoreNewlinesFromPlaceholders,
	NEWLINE_PLACEHOLDER,
	CARRIAGE_RETURN_PLACEHOLDER,
} from "../quote-protection"

describe("protectNewlinesInQuotes", () => {
	const newlinePlaceholder = NEWLINE_PLACEHOLDER
	const crPlaceholder = CARRIAGE_RETURN_PLACEHOLDER

	describe("basic quote handling", () => {
		it("protects newlines in double quotes", () => {
			const input = 'echo "hello\nworld"'
			const expected = `echo "hello${newlinePlaceholder}world"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("protects newlines in single quotes", () => {
			const input = "echo 'hello\nworld'"
			const expected = `echo 'hello${newlinePlaceholder}world'`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("does not protect newlines outside quotes", () => {
			const input = "echo hello\necho world"
			const expected = "echo hello\necho world"
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})
	})

	describe("quote concatenation", () => {
		it("handles quote concatenation where content between quotes is NOT quoted", () => {
			// In bash: echo '"'A'"' prints "A" (A is not quoted)
			const input = `echo '"'A\n'"'`
			// The newline after A is NOT inside quotes, so it should NOT be protected
			const expected = `echo '"'A\n'"'`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles alternating quotes correctly", () => {
			// echo "hello"world"test" -> hello is quoted, world is not, test is quoted
			const input = `echo "hello\n"world\n"test\n"`
			const expected = `echo "hello${newlinePlaceholder}"world\n"test${newlinePlaceholder}"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles single quote after double quote", () => {
			const input = `echo "hello"'world\n'`
			const expected = `echo "hello"'world${newlinePlaceholder}'`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles double quote after single quote", () => {
			const input = `echo 'hello'"world\n"`
			const expected = `echo 'hello'"world${newlinePlaceholder}"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})
	})

	describe("escaped quotes", () => {
		it("handles escaped double quotes in double-quoted strings", () => {
			const input = 'echo "hello\\"world\n"'
			const expected = `echo "hello\\"world${newlinePlaceholder}"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("does not treat backslash as escape in single quotes", () => {
			// In single quotes, backslash is literal (except for \' in some shells)
			const input = "echo 'hello\\'world\n'"
			// The \\ is literal, the ' ends the quote, so world\n is outside quotes
			const expected = "echo 'hello\\'world\n'"
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})
	})

	describe("edge cases", () => {
		it("handles unclosed quotes", () => {
			const input = 'echo "unclosed\n'
			const expected = `echo "unclosed${newlinePlaceholder}`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles empty string", () => {
			expect(protectNewlinesInQuotes("", newlinePlaceholder, crPlaceholder)).toBe("")
		})

		it("handles string with no quotes", () => {
			const input = "echo hello\nworld"
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(input)
		})

		it("handles multiple newlines in quotes", () => {
			const input = 'echo "line1\nline2\nline3"'
			const expected = `echo "line1${newlinePlaceholder}line2${newlinePlaceholder}line3"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles carriage returns", () => {
			const input = 'echo "hello\rworld"'
			const expected = `echo "hello${crPlaceholder}world"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles CRLF", () => {
			const input = 'echo "hello\r\nworld"'
			const expected = `echo "hello${crPlaceholder}${newlinePlaceholder}world"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})
	})

	describe("real-world git commit examples", () => {
		it("protects newlines in git commit message", () => {
			const input = `git commit -m "feat: title\n\n- point a\n- point b"`
			const expected = `git commit -m "feat: title${newlinePlaceholder}${newlinePlaceholder}- point a${newlinePlaceholder}- point b"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})

		it("handles complex git command with multiple quoted sections", () => {
			const input = `git add . && git commit -m "feat: title\n\n- point a" && echo "done\n"`
			const expected = `git add . && git commit -m "feat: title${newlinePlaceholder}${newlinePlaceholder}- point a" && echo "done${newlinePlaceholder}"`
			expect(protectNewlinesInQuotes(input, newlinePlaceholder, crPlaceholder)).toBe(expected)
		})
	})
})

describe("restoreNewlinesFromPlaceholders", () => {
	it("restores newlines from placeholders", () => {
		const input = `echo "hello${NEWLINE_PLACEHOLDER}world"`
		const expected = 'echo "hello\nworld"'
		expect(restoreNewlinesFromPlaceholders(input, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)).toBe(expected)
	})

	it("restores carriage returns from placeholders", () => {
		const input = `echo "hello${CARRIAGE_RETURN_PLACEHOLDER}world"`
		const expected = 'echo "hello\rworld"'
		expect(restoreNewlinesFromPlaceholders(input, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)).toBe(expected)
	})

	it("restores both newlines and carriage returns", () => {
		const input = `echo "hello${CARRIAGE_RETURN_PLACEHOLDER}${NEWLINE_PLACEHOLDER}world"`
		const expected = 'echo "hello\r\nworld"'
		expect(restoreNewlinesFromPlaceholders(input, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)).toBe(expected)
	})

	it("handles string with no placeholders", () => {
		const input = 'echo "hello world"'
		expect(restoreNewlinesFromPlaceholders(input, NEWLINE_PLACEHOLDER, CARRIAGE_RETURN_PLACEHOLDER)).toBe(input)
	})
})
