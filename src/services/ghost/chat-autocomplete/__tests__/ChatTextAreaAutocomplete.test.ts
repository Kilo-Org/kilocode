import { ChatTextAreaAutocomplete } from "../ChatTextAreaAutocomplete"
import { ProviderSettingsManager } from "../../../../core/config/ProviderSettingsManager"

describe("ChatTextAreaAutocomplete", () => {
	let autocomplete: ChatTextAreaAutocomplete
	let mockProviderSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		mockProviderSettingsManager = {} as ProviderSettingsManager
		autocomplete = new ChatTextAreaAutocomplete(mockProviderSettingsManager)
	})

	describe("isFimAvailable", () => {
		it("should return false when model is not loaded", () => {
			const result = autocomplete.isFimAvailable()
			expect(result).toBe(false)
		})
	})

	describe("isUnwantedSuggestion", () => {
		it("should filter code patterns (comments, preprocessor, short/empty)", () => {
			const filter = autocomplete.isUnwantedSuggestion.bind(autocomplete)

			// Comments
			expect(filter("// comment")).toBe(true)
			expect(filter("/* comment")).toBe(true)
			expect(filter("*")).toBe(true)

			// Code patterns
			expect(filter("#include")).toBe(true)
			expect(filter("# Header")).toBe(true)

			// Meaningless content
			expect(filter("")).toBe(true)
			expect(filter("a")).toBe(true)
			expect(filter("...")).toBe(true)
		})

		it("should accept natural language suggestions", () => {
			const filter = autocomplete.isUnwantedSuggestion.bind(autocomplete)

			expect(filter("Hello world")).toBe(false)
			expect(filter("Can you help me")).toBe(false)
			expect(filter("test123")).toBe(false)
			expect(filter("What's up?")).toBe(false)
		})

		it("should accept symbols in middle of text", () => {
			const filter = autocomplete.isUnwantedSuggestion.bind(autocomplete)

			expect(filter("Text with # in middle")).toBe(false)
			expect(filter("Hello // but not a comment")).toBe(false)
		})
	})
})
