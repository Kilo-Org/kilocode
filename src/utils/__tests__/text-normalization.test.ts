import { normalizeString, unescapeHtmlEntities } from "../text-normalization"

describe("Text normalization utilities", () => {
	describe("normalizeString", () => {
		test("normalizes smart quotes by default", () => {
			expect(normalizeString("These are \u201Csmart quotes\u201D and \u2018single quotes\u2019")).toBe(
				"These are \"smart quotes\" and 'single quotes'",
			)
		})

		test("normalizes typographic characters by default", () => {
			expect(normalizeString("This has an em dash \u2014 and ellipsis\u2026")).toBe(
				"This has an em dash - and ellipsis...",
			)
		})

		test("normalizes whitespace by default", () => {
			expect(normalizeString("Multiple   spaces and\t\ttabs")).toBe("Multiple spaces and tabs")
		})

		test("can be configured to skip certain normalizations", () => {
			const input = "Keep \u201Csmart quotes\u201D but normalize   whitespace"
			expect(normalizeString(input, { smartQuotes: false })).toBe(
				"Keep \u201Csmart quotes\u201D but normalize whitespace",
			)
		})

		test("real-world example with mixed characters", () => {
			const input = "Let\u2019s test this\u2014with some \u201Cfancy\u201D punctuation\u2026 and   spaces"
			expect(normalizeString(input)).toBe('Let\'s test this-with some "fancy" punctuation... and spaces')
		})
	})

	describe("unescapeHtmlEntities", () => {
		test("unescapes basic HTML entities", () => {
			expect(unescapeHtmlEntities("&lt;div&gt;Hello&lt;/div&gt;")).toBe("<div>Hello</div>")
		})

		test("unescapes ampersand entity", () => {
			expect(unescapeHtmlEntities("This &amp; that")).toBe("This & that")
		})

		test("unescapes quote entities", () => {
			expect(unescapeHtmlEntities("&quot;quoted&quot; and &#39;single-quoted&#39;")).toBe(
				"\"quoted\" and 'single-quoted'",
			)
		})

		test("unescapes apostrophe entity", () => {
			expect(unescapeHtmlEntities("Don&apos;t worry")).toBe("Don't worry")
		})

		test("handles mixed content with multiple entity types", () => {
			expect(
				unescapeHtmlEntities(
					"&lt;a href=&quot;https://example.com?param1=value&amp;param2=value&quot;&gt;Link&lt;/a&gt;",
				),
			).toBe('<a href="https://example.com?param1=value&param2=value">Link</a>')
		})

		test("handles mixed content with apostrophe entities", () => {
			expect(
				unescapeHtmlEntities(
					"&lt;div&gt;Don&apos;t forget that Tom&amp;Jerry&apos;s show is at 3 o&apos;clock&lt;/div&gt;",
				),
			).toBe("<div>Don't forget that Tom&Jerry's show is at 3 o'clock</div>")
		})

		test("returns original string when no entities are present", () => {
			const original = "Plain text without entities"
			expect(unescapeHtmlEntities(original)).toBe(original)
		})

		test("handles empty or undefined input", () => {
			expect(unescapeHtmlEntities("")).toBe("")
			expect(unescapeHtmlEntities(undefined as unknown as string)).toBe(undefined)
		})
	})
})
