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

	describe("cleanSuggestion", () => {
		it("should filter code patterns (comments, preprocessor)", () => {
			// Comments - filtered by the regex check in cleanSuggestion
			expect(autocomplete.cleanSuggestion("// comment", "")).toBe("")
			expect(autocomplete.cleanSuggestion("/* comment", "")).toBe("")
			expect(autocomplete.cleanSuggestion("* something", "")).toBe("")

			// Code patterns
			expect(autocomplete.cleanSuggestion("#include", "")).toBe("")
			expect(autocomplete.cleanSuggestion("# Header", "")).toBe("")
		})

		it("should filter empty content", () => {
			// Empty content is filtered by postprocessGhostSuggestion
			expect(autocomplete.cleanSuggestion("", "")).toBe("")
		})

		it("should accept natural language suggestions", () => {
			expect(autocomplete.cleanSuggestion("Hello world", "")).toBe("Hello world")
			expect(autocomplete.cleanSuggestion("Can you help me", "")).toBe("Can you help me")
			expect(autocomplete.cleanSuggestion("test123", "")).toBe("test123")
			expect(autocomplete.cleanSuggestion("What's up?", "")).toBe("What's up?")
		})

		it("should accept symbols in middle of text", () => {
			expect(autocomplete.cleanSuggestion("Text with # in middle", "")).toBe("Text with # in middle")
			expect(autocomplete.cleanSuggestion("Hello // but not a comment", "")).toBe("Hello // but not a comment")
		})

		it("should truncate at first newline", () => {
			expect(autocomplete.cleanSuggestion("First line\nSecond line", "")).toBe("First line")
		})

		it("should remove prefix overlap", () => {
			expect(autocomplete.cleanSuggestion("Hello world", "Hello ")).toBe("world")
		})
	})
})
