import {
	extractPastedTextReferences,
	removePastedTextReferences,
	expandPastedTextReferences,
	PASTED_TEXT_REFERENCE_REGEX,
} from "../processPastedText"

describe("processPastedText helpers", () => {
	describe("PASTED_TEXT_REFERENCE_REGEX", () => {
		it("should match valid pasted text references", () => {
			const text = "[Pasted text #1 +25 lines]"
			PASTED_TEXT_REFERENCE_REGEX.lastIndex = 0
			const match = PASTED_TEXT_REFERENCE_REGEX.exec(text)
			expect(match).not.toBeNull()
			expect(match?.[1]).toBe("1")
			expect(match?.[2]).toBe("25")
		})

		it("should match references with large numbers", () => {
			const text = "[Pasted text #999 +1000 lines]"
			PASTED_TEXT_REFERENCE_REGEX.lastIndex = 0
			const match = PASTED_TEXT_REFERENCE_REGEX.exec(text)
			expect(match).not.toBeNull()
			expect(match?.[1]).toBe("999")
			expect(match?.[2]).toBe("1000")
		})

		it("should not match malformed references", () => {
			const malformed = [
				"[Pasted text #1]", // missing line count
				"[Pasted text 1 +25 lines]", // missing #
				"[Pasted #1 +25 lines]", // missing "text"
				"Pasted text #1 +25 lines", // missing brackets
				"[Pasted text #a +25 lines]", // non-numeric ref
			]

			for (const text of malformed) {
				PASTED_TEXT_REFERENCE_REGEX.lastIndex = 0
				const match = PASTED_TEXT_REFERENCE_REGEX.exec(text)
				expect(match).toBeNull()
			}
		})
	})

	describe("extractPastedTextReferences", () => {
		it("should extract single reference number", () => {
			const input = "Hello [Pasted text #1 +25 lines] world"
			const result = extractPastedTextReferences(input)
			expect(result).toEqual([1])
		})

		it("should extract multiple reference numbers in order", () => {
			const input = "[Pasted text #1 +10 lines] and [Pasted text #3 +50 lines] and [Pasted text #2 +30 lines]"
			const result = extractPastedTextReferences(input)
			expect(result).toEqual([1, 3, 2])
		})

		it("should return empty array when no references", () => {
			const input = "Hello world"
			const result = extractPastedTextReferences(input)
			expect(result).toEqual([])
		})

		it("should handle large reference numbers", () => {
			const input = "[Pasted text #999 +1 lines]"
			const result = extractPastedTextReferences(input)
			expect(result).toEqual([999])
		})

		it("should not extract from similar but invalid patterns", () => {
			const input = "[Pasted text #1] [Image #2] [Pasted #3 +10 lines]"
			const result = extractPastedTextReferences(input)
			expect(result).toEqual([])
		})
	})

	describe("removePastedTextReferences", () => {
		it("should remove pasted text reference tokens without collapsing whitespace", () => {
			const input = "Line1\n  [Pasted text #1 +25 lines]\nLine3"
			const result = removePastedTextReferences(input)
			expect(result).toBe("Line1\n  \nLine3")
		})

		it("should remove multiple references", () => {
			const input = "Hello [Pasted text #1 +10 lines] world [Pasted text #2 +20 lines] test"
			const result = removePastedTextReferences(input)
			expect(result).toBe("Hello  world  test")
		})

		it("should handle text with no references", () => {
			const input = "Hello world"
			const result = removePastedTextReferences(input)
			expect(result).toBe("Hello world")
		})

		it("should preserve image references", () => {
			const input = "[Image #1] [Pasted text #2 +10 lines]"
			const result = removePastedTextReferences(input)
			expect(result).toBe("[Image #1] ")
		})
	})

	describe("expandPastedTextReferences", () => {
		it("should expand single reference with full text", () => {
			const input = "Check this: [Pasted text #1 +3 lines]"
			const references = { 1: "line one\nline two\nline three" }
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("Check this: line one\nline two\nline three")
		})

		it("should expand multiple references", () => {
			const input = "[Pasted text #1 +2 lines] and [Pasted text #2 +1 lines]"
			const references = {
				1: "first\nsecond",
				2: "single line",
			}
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("first\nsecond and single line")
		})

		it("should leave unknown references unchanged", () => {
			const input = "Check this: [Pasted text #99 +10 lines]"
			const references = { 1: "some text" }
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("Check this: [Pasted text #99 +10 lines]")
		})

		it("should handle empty references map", () => {
			const input = "[Pasted text #1 +5 lines]"
			const references = {}
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("[Pasted text #1 +5 lines]")
		})

		it("should handle text with no references", () => {
			const input = "Hello world"
			const references = { 1: "unused" }
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("Hello world")
		})

		it("should handle mixed references (expand known, keep unknown)", () => {
			const input = "[Pasted text #1 +2 lines] [Pasted text #2 +3 lines] [Pasted text #3 +1 lines]"
			const references = {
				1: "found\ntext",
				3: "also found",
			}
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("found\ntext [Pasted text #2 +3 lines] also found")
		})

		it("should preserve surrounding text and whitespace", () => {
			const input = "   Before [Pasted text #1 +1 lines] After   "
			const references = { 1: "middle" }
			const result = expandPastedTextReferences(input, references)
			expect(result).toBe("   Before middle After   ")
		})
	})
})
