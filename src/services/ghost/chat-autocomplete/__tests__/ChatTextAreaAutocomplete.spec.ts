import { ChatTextAreaAutocomplete } from "../ChatTextAreaAutocomplete"
import { ProviderSettingsManager } from "../../../../core/config/ProviderSettingsManager"
import { GhostModel } from "../../GhostModel"
import { ApiStreamChunk } from "../../../../api/transform/stream"

describe("ChatTextAreaAutocomplete", () => {
	let autocomplete: ChatTextAreaAutocomplete
	let mockProviderSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		mockProviderSettingsManager = {} as ProviderSettingsManager
		autocomplete = new ChatTextAreaAutocomplete(mockProviderSettingsManager)
	})

	describe("getCompletion", () => {
		it("should work with non-FIM models using chat-based completion", async () => {
			// Setup: Model without FIM support (like Mistral)
			const mockModel = new GhostModel()
			mockModel.loaded = true

			vi.spyOn(mockModel, "hasValidCredentials").mockReturnValue(true)
			vi.spyOn(mockModel, "supportsFim").mockReturnValue(false)
			vi.spyOn(mockModel, "generateResponse").mockImplementation(async (systemPrompt, userPrompt, onChunk) => {
				// Simulate streaming chat response
				const chunks: ApiStreamChunk[] = [{ type: "text", text: "write a function" }]
				for (const chunk of chunks) {
					onChunk(chunk)
				}
				return {
					cost: 0,
					inputTokens: 15,
					outputTokens: 8,
					cacheWriteTokens: 0,
					cacheReadTokens: 0,
				}
			})

			// @ts-expect-error - accessing private property for test
			autocomplete.model = mockModel

			const result = await autocomplete.getCompletion("How to ")

			expect(mockModel.generateResponse).toHaveBeenCalled()
			expect(result.suggestion).toBe("write a function")
		})
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
