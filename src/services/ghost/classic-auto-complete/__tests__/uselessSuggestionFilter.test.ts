import { postprocessGhostSuggestion, suggestionConsideredDuplication } from "../uselessSuggestionFilter"

describe("postprocessGhostSuggestion", () => {
	it("filters suggestions that are considered duplication (prefix/suffix match)", () => {
		const result = postprocessGhostSuggestion({
			suggestion: "hello",
			prefix: "hello",
			suffix: "",
			model: "",
		})

		expect(result).toBeUndefined()
	})

	it("filters suggestions that rewrite the line above (continuedev postprocessCompletion behavior)", () => {
		const prefix = "function test() {\n  return true\n  "
		const suggestion = "return true"
		const result = postprocessGhostSuggestion({ suggestion, prefix, suffix: "", model: "" })
		expect(result).toBeUndefined()
	})

	describe("model-specific postprocessing", () => {
		it("removes markdown code fences", () => {
			const suggestion = "```javascript\nconst x = 1\n```"
			const result = postprocessGhostSuggestion({
				suggestion,
				prefix: "",
				suffix: "",
				model: "gpt-4",
			})
			expect(result).toBe("const x = 1")
		})

		it("handles Codestral-specific quirks", () => {
			// Codestral sometimes adds extra leading space
			const result = postprocessGhostSuggestion({
				suggestion: " test",
				prefix: "const x = ",
				suffix: "\n",
				model: "codestral",
			})
			expect(result).toBe("test")
		})

		it("handles Mercury/Granite prefix duplication", () => {
			const result = postprocessGhostSuggestion({
				suggestion: "const x = 42",
				prefix: "const x = ",
				suffix: "",
				model: "granite-20b",
			})
			expect(result).toBe("42")
		})

		it("handles Gemini/Gemma file separator", () => {
			const result = postprocessGhostSuggestion({
				suggestion: "const x = 1<|file_separator|>",
				prefix: "",
				suffix: "",
				model: "gemini-pro",
			})
			expect(result).toBe("const x = 1")
		})
	})

	describe("extreme repetition filtering", () => {
		it("filters extreme repetition", () => {
			const repetitive = "test\ntest\ntest\ntest\ntest\ntest\ntest\ntest\ntest\n"
			const result = postprocessGhostSuggestion({
				suggestion: repetitive,
				prefix: "",
				suffix: "",
				model: "",
			})
			expect(result).toBeUndefined()
		})

		it("allows normal repetition", () => {
			const normal = "test1\ntest2\ntest3\ntest4\n"
			const result = postprocessGhostSuggestion({
				suggestion: normal,
				prefix: "",
				suffix: "",
				model: "",
			})
			expect(result).toBe(normal)
		})
	})
})

describe("suggestionConsideredDuplication", () => {
	/**
	 * Helper that takes a single string with <<< and >>> markers around the suggestion.
	 * Format: "prefix<<<suggestion>>>suffix"
	 * This makes it easier to test multiline strings.
	 */
	const isDuplication = (input: string) => {
		const startMarker = "<<<"
		const endMarker = ">>>"
		const startIdx = input.indexOf(startMarker)
		const endIdx = input.indexOf(endMarker)

		if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
			throw new Error(`Invalid input format. Expected "prefix<<<suggestion>>>suffix", got: ${input}`)
		}

		const prefix = input.slice(0, startIdx)
		const suggestion = input.slice(startIdx + startMarker.length, endIdx)
		const suffix = input.slice(endIdx + endMarker.length)

		return suggestionConsideredDuplication({ suggestion, prefix, suffix })
	}

	it("treats empty/whitespace-only suggestions as duplication", () => {
		expect(isDuplication("const x = <<<>>> + 1")).toBe(true)
		expect(isDuplication("const x = <<<   >>> + 1")).toBe(true)
		expect(isDuplication("const x = <<<\t\n>>> + 1")).toBe(true)
	})

	it("treats suggestion as duplication when it matches the end of the prefix (trim-aware)", () => {
		// Exact match at the end
		expect(isDuplication("const x = hello<<<hello>>>")).toBe(true)
		expect(isDuplication("hello world<<<world>>> + 1")).toBe(true)

		// With whitespace variations
		expect(isDuplication("const test <<<test>>>")).toBe(true)
		expect(isDuplication("bar foo  <<<foo>>>")).toBe(true)
	})

	it("treats suggestion as duplication when it matches the start of the suffix (trim-aware)", () => {
		// Exact match at the start
		expect(isDuplication("const x = <<<hello>>>hello world")).toBe(true)
		expect(isDuplication("<<<const>>>const y = 2")).toBe(true)

		// With whitespace variations
		expect(isDuplication("const x = <<<test>>>  test()")).toBe(true)
		expect(isDuplication("<<<foo>>> foo bar")).toBe(true)

		// Trimmed match
		expect(isDuplication("const x = <<<bar>>>  bar  baz")).toBe(true)
	})

	it("trims suggestion before comparing to prefix/suffix", () => {
		expect(isDuplication("const x = <<<  hello  >>>hello world")).toBe(true)
		expect(isDuplication("test hello<<<\nhello\t>>>")).toBe(true)
	})

	it("returns false for useful suggestions that do not match prefix end or suffix start", () => {
		expect(isDuplication("const x = <<<newValue>>>")).toBe(false)
		expect(isDuplication("const x = <<<42>>> + y")).toBe(false)
		expect(isDuplication("const x = <<<middle>>> + y")).toBe(false)

		expect(isDuplication("const x = <<<hello>>>world")).toBe(false)
		expect(isDuplication("const x = <<<test>>>const y = 2")).toBe(false)
		expect(isDuplication("bar<<<foo>>>baz")).toBe(false)
	})

	it("does not consider partial matches at the edge as duplication", () => {
		// Suggestion "hello world" with prefix ending in "hello" is NOT a duplication
		expect(isDuplication("const x = hello<<<hello world>>>")).toBe(false)
		expect(isDuplication("test<<<test123>>>456")).toBe(false)
	})

	it("handles empty prefix and suffix", () => {
		expect(isDuplication("<<<hello>>>")).toBe(false)
		expect(isDuplication("<<<>>>")).toBe(true)
	})

	it("handles very long strings", () => {
		const longString = "a".repeat(1000)
		expect(isDuplication(`${longString}<<<different>>>${longString}`)).toBe(false)
		expect(isDuplication(`${longString}different<<<different>>>`)).toBe(true)
	})

	it("handles special characters", () => {
		expect(isDuplication("const template = `<<<${}>>>${}")).toBe(true)
		expect(isDuplication("const x = <<<\\n>>>\\n")).toBe(true)
		expect(isDuplication("const x = /**/<<</**/>>>")).toBe(true)
	})

	it("handles unicode characters", () => {
		expect(isDuplication("const emoji = <<<😀>>>😀")).toBe(true)
		expect(isDuplication("const greeting = 你好<<<你好>>>")).toBe(true)
		expect(isDuplication("launch<<<🚀>>>🌟")).toBe(false)
	})

	it("treats as duplication when completed line equals the last complete line in prefix", () => {
		// The suggestion completes the current line to match the previous line
		expect(
			isDuplication(`
doStuff()

console.info('logging some stuff')
console.info<<<('logging some stuff')>>>

if (foo) {`),
		).toBe(true)

		expect(
			isDuplication(`
doStuff()

console.info<<<('logging some stuff')>>>
console.info('logging some stuff')

if (foo) {`),
		).toBe(true)

		// Different variations - exact match with same spacing
		expect(
			isDuplication(`const x = 1
const x <<<= 1>>>
`),
		).toBe(true)

		// Should NOT be duplication when the completed line is different
		expect(
			isDuplication(`
doStuff()

console.info('logging some stuff')
console.info<<<('logging different stuff')>>>

if (foo) {`),
		).toBe(false)

		// Should NOT be duplication when there's no previous complete line
		expect(isDuplication(`console.info<<<('logging some stuff')>>>`)).toBe(false)
	})

	it("treats as duplication when a multiline suggestion duplicates the last line in prefix on its first line", () => {
		expect(
			isDuplication(`doStuff()
console.info('logging some stuff')
<<<console.info('logging some stuff')
if (foo) {
	 bar()
}>>>`),
		).toBe(true)
	})

	it("treats as duplication when a multiline suggestion duplicates the first line in suffix on its last line", () => {
		expect(
			isDuplication(`doStuff()
<<<if (foo) {
	 bar()
}
console.info('logging some stuff')>>>console.info('logging some stuff')
return 1
`),
		).toBe(true)
	})
})
