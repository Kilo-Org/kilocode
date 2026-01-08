import { ChatTextAreaAutocomplete } from "../ChatTextAreaAutocomplete"
import { ProviderSettingsManager } from "../../../../core/config/ProviderSettingsManager"
import { GhostModel } from "../../GhostModel"
import { ApiStreamChunk } from "../../../../api/transform/stream"
import { HoleFiller } from "../../classic-auto-complete/HoleFiller"
import { HoleFillerGhostPrompt, FillInAtCursorSuggestion } from "../../types"

describe("ChatTextAreaAutocomplete", () => {
	let autocomplete: ChatTextAreaAutocomplete
	let mockProviderSettingsManager: ProviderSettingsManager

	beforeEach(() => {
		mockProviderSettingsManager = {} as ProviderSettingsManager
		autocomplete = new ChatTextAreaAutocomplete(mockProviderSettingsManager)
	})

	describe("getCompletion", () => {
		it("should work with non-FIM models using chat-based completion with COMPLETION tags", async () => {
			// Setup: Model without FIM support (like Mistral)
			const mockModel = new GhostModel()
			mockModel.loaded = true

			vi.spyOn(mockModel, "hasValidCredentials").mockReturnValue(true)
			vi.spyOn(mockModel, "supportsFim").mockReturnValue(false)
			vi.spyOn(mockModel, "generateResponse").mockImplementation(async (systemPrompt, userPrompt, onChunk) => {
				// Simulate streaming chat response with COMPLETION tags (shared format with HoleFiller)
				const chunks: ApiStreamChunk[] = [{ type: "text", text: "<COMPLETION>write a function</COMPLETION>" }]
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

			// Create a mock HoleFiller
			const mockHoleFiller = {
				getPrompts: vi.fn().mockResolvedValue({
					strategy: "hole_filler",
					systemPrompt: "test system prompt",
					userPrompt: "test user prompt",
					autocompleteInput: {},
				} as HoleFillerGhostPrompt),
				getFromChat: vi
					.fn()
					.mockImplementation(
						async (
							model: GhostModel,
							prompt: HoleFillerGhostPrompt,
							processSuggestion: (text: string) => FillInAtCursorSuggestion,
						) => {
							// Simulate the HoleFiller calling generateResponse and processing the result
							const chunks: ApiStreamChunk[] = [
								{ type: "text", text: "<COMPLETION>write a function</COMPLETION>" },
							]
							let response = ""
							for (const chunk of chunks) {
								if (chunk.type === "text") {
									response += chunk.text
								}
							}
							// Extract from COMPLETION tags like HoleFiller does
							const match = response.match(/<COMPLETION>([\s\S]*?)<\/COMPLETION>/i)
							const text = match ? match[1] : ""
							return {
								suggestion: processSuggestion(text),
								cost: 0,
								inputTokens: 15,
								outputTokens: 8,
								cacheWriteTokens: 0,
								cacheReadTokens: 0,
							}
						},
					),
			} as unknown as HoleFiller

			// @ts-expect-error - accessing private property for test
			autocomplete.model = mockModel
			// @ts-expect-error - accessing private property for test
			autocomplete.holeFiller = mockHoleFiller

			const result = await autocomplete.getCompletion("How to ")

			expect(mockHoleFiller.getFromChat).toHaveBeenCalled()
			expect(result.suggestion).toBe("write a function")
		})

		it("should handle chat response without COMPLETION tags (fallback)", async () => {
			// Setup: Model without FIM support that doesn't use tags
			const mockModel = new GhostModel()
			mockModel.loaded = true

			vi.spyOn(mockModel, "hasValidCredentials").mockReturnValue(true)
			vi.spyOn(mockModel, "supportsFim").mockReturnValue(false)
			vi.spyOn(mockModel, "generateResponse").mockImplementation(async (systemPrompt, userPrompt, onChunk) => {
				// Simulate streaming chat response without tags (fallback behavior)
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

			// Create a mock HoleFiller that returns response without tags
			const mockHoleFiller = {
				getPrompts: vi.fn().mockResolvedValue({
					strategy: "hole_filler",
					systemPrompt: "test system prompt",
					userPrompt: "test user prompt",
					autocompleteInput: {},
				} as HoleFillerGhostPrompt),
				getFromChat: vi
					.fn()
					.mockImplementation(
						async (
							model: GhostModel,
							prompt: HoleFillerGhostPrompt,
							processSuggestion: (text: string) => FillInAtCursorSuggestion,
						) => {
							// Simulate response without COMPLETION tags - HoleFiller returns empty string
							// but the fallback behavior in parseGhostResponse returns the raw text
							return {
								suggestion: processSuggestion("write a function"),
								cost: 0,
								inputTokens: 15,
								outputTokens: 8,
								cacheWriteTokens: 0,
								cacheReadTokens: 0,
							}
						},
					),
			} as unknown as HoleFiller

			// @ts-expect-error - accessing private property for test
			autocomplete.model = mockModel
			// @ts-expect-error - accessing private property for test
			autocomplete.holeFiller = mockHoleFiller

			const result = await autocomplete.getCompletion("How to ")

			expect(mockHoleFiller.getFromChat).toHaveBeenCalled()
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
