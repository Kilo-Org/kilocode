import { seekSequence } from "../seek-sequence"

describe("seek-sequence", () => {
	describe("seekSequence", () => {
		function toVec(strings: string[]): string[] {
			return strings
		}

		it("should match exact sequence", () => {
			const lines = toVec(["foo", "bar", "baz"])
			const pattern = toVec(["bar", "baz"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(1)
		})

		it("should return start for empty pattern", () => {
			const lines = toVec(["foo", "bar"])
			const pattern = toVec([])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
			expect(seekSequence(lines, pattern, 5, false)).toBe(5)
		})

		it("should return null when pattern is longer than input", () => {
			const lines = toVec(["just one line"])
			const pattern = toVec(["too", "many", "lines"])
			expect(seekSequence(lines, pattern, 0, false)).toBeNull()
		})

		it("should match ignoring trailing whitespace", () => {
			const lines = toVec(["foo   ", "bar\t\t"])
			const pattern = toVec(["foo", "bar"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should match ignoring leading and trailing whitespace", () => {
			const lines = toVec(["    foo   ", "   bar\t"])
			const pattern = toVec(["foo", "bar"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should respect start parameter", () => {
			const lines = toVec(["foo", "bar", "foo", "baz"])
			const pattern = toVec(["foo"])
			// Starting at 0 should find first foo
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
			// Starting at 1 should find second foo
			expect(seekSequence(lines, pattern, 1, false)).toBe(2)
		})

		it("should search from end when eof is true", () => {
			const lines = toVec(["foo", "bar", "foo", "baz"])
			const pattern = toVec(["foo", "baz"])
			// With eof=true, should find at the end
			expect(seekSequence(lines, pattern, 0, true)).toBe(2)
		})

		it("should handle Unicode normalization - dashes", () => {
			// EN DASH (\u2013) and NON-BREAKING HYPHEN (\u2011) → ASCII '-'
			const lines = toVec(["hello \u2013 world \u2011 test"])
			const pattern = toVec(["hello - world - test"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should handle Unicode normalization - quotes", () => {
			// Fancy single quotes → ASCII '\''
			const lines = toVec(["it\u2019s working"]) // RIGHT SINGLE QUOTATION MARK
			const pattern = toVec(["it's working"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should handle Unicode normalization - double quotes", () => {
			// Fancy double quotes → ASCII '"'
			const lines = toVec(["\u201Chello\u201D"]) // LEFT/RIGHT DOUBLE QUOTATION MARK
			const pattern = toVec(['"hello"'])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should handle Unicode normalization - non-breaking space", () => {
			// Non-breaking space (\u00A0) → normal space
			const lines = toVec(["hello\u00A0world"])
			const pattern = toVec(["hello world"])
			expect(seekSequence(lines, pattern, 0, false)).toBe(0)
		})

		it("should return null when pattern not found", () => {
			const lines = toVec(["foo", "bar", "baz"])
			const pattern = toVec(["qux"])
			expect(seekSequence(lines, pattern, 0, false)).toBeNull()
		})

		it("should return null when start is past possible match", () => {
			const lines = toVec(["foo", "bar", "baz"])
			const pattern = toVec(["foo", "bar"])
			// Starting at 2, there's not enough room for a 2-line pattern
			expect(seekSequence(lines, pattern, 2, false)).toBeNull()
		})
	})
})
