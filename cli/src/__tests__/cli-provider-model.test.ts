import { describe, it, expect } from "vitest"
import type { CLIConfig, ProviderConfig } from "../config/types.js"
import { getModelFieldForProvider, getModelIdKey } from "../constants/providers/models.js"
import type { ProviderName } from "../types/messages.js"

describe("Provider and Model CLI Options", () => {
	describe("getModelIdKey", () => {
		it("should return correct model field for kilocode provider", () => {
			const field = getModelIdKey("kilocode")
			expect(field).toBe("kilocodeModel")
		})

		it("should return correct model field for anthropic provider", () => {
			const field = getModelIdKey("anthropic")
			expect(field).toBe("apiModelId")
		})

		it("should return correct model field for openai provider", () => {
			const field = getModelIdKey("openai")
			expect(field).toBe("openAiModelId")
		})

		it("should return correct model field for openai-native provider", () => {
			const field = getModelIdKey("openai-native")
			expect(field).toBe("apiModelId")
		})

		it("should return apiModelId as default for unknown providers", () => {
			const field = getModelIdKey("human-relay")
			expect(field).toBe("apiModelId")
		})
	})

	describe("getModelFieldForProvider (router support)", () => {
		it("should return model field for router-supported providers", () => {
			expect(getModelFieldForProvider("kilocode")).toBe("kilocodeModel")
			expect(getModelFieldForProvider("openrouter")).toBe("openRouterModelId")
			expect(getModelFieldForProvider("ollama")).toBe("ollamaModelId")
		})

		it("should return null for providers without router support", () => {
			expect(getModelFieldForProvider("anthropic")).toBeNull()
			expect(getModelFieldForProvider("openai")).toBeNull()
			expect(getModelFieldForProvider("human-relay")).toBeNull()
		})
	})

	describe("Provider Override Logic", () => {
		const mockConfig: CLIConfig = {
			version: "1.0.0",
			mode: "code",
			telemetry: false,
			provider: "kilocode-1",
			providers: [
				{
					id: "kilocode-1",
					provider: "kilocode",
					kilocodeModel: "claude-sonnet-3.5",
					kilocodeToken: "test-token",
				},
				{
					id: "anthropic-main",
					provider: "anthropic",
					apiModelId: "claude-3-5-sonnet-20241022",
					apiKey: "test-key",
				},
				{
					id: "openai-1",
					provider: "openai",
					openAiModelId: "gpt-4",
					openAiApiKey: "test-key",
				},
			],
		}

		it("should find provider by ID", () => {
			const provider = mockConfig.providers.find((p) => p.id === "anthropic-main")
			expect(provider).toBeDefined()
			expect(provider?.provider).toBe("anthropic")
		})

		it("should update provider selection", () => {
			const updatedConfig = {
				...mockConfig,
				provider: "anthropic-main",
			}
			expect(updatedConfig.provider).toBe("anthropic-main")
			expect(mockConfig.provider).toBe("kilocode-1") // Original unchanged
		})

		it("should update model for kilocode provider", () => {
			const providerIndex = mockConfig.providers.findIndex((p) => p.id === "kilocode-1")
			const provider = mockConfig.providers[providerIndex]
			const modelField = getModelIdKey("kilocode")

			expect(modelField).toBe("kilocodeModel")
			expect(provider).toBeDefined()

			if (provider && modelField) {
				const updatedProvider = {
					...provider,
					[modelField]: "claude-opus-4",
				}
				expect(updatedProvider.kilocodeModel).toBe("claude-opus-4")
			}
		})

		it("should update model for anthropic provider", () => {
			const providerIndex = mockConfig.providers.findIndex((p) => p.id === "anthropic-main")
			const provider = mockConfig.providers[providerIndex]
			const modelField = getModelIdKey("anthropic")

			expect(modelField).toBe("apiModelId")
			expect(provider).toBeDefined()

			if (provider && modelField && "apiModelId" in provider) {
				const updatedProvider = {
					...provider,
					[modelField]: "claude-opus-4",
				} as ProviderConfig
				if ("apiModelId" in updatedProvider) {
					expect(updatedProvider.apiModelId).toBe("claude-opus-4")
				}
			}
		})

		it("should update model for openai provider", () => {
			const providerIndex = mockConfig.providers.findIndex((p) => p.id === "openai-1")
			const provider = mockConfig.providers[providerIndex]
			const modelField = getModelIdKey("openai")

			expect(modelField).toBe("openAiModelId")
			expect(provider).toBeDefined()

			if (provider && modelField && "openAiModelId" in provider) {
				const updatedProvider = {
					...provider,
					[modelField]: "gpt-4-turbo",
				} as ProviderConfig
				if ("openAiModelId" in updatedProvider) {
					expect(updatedProvider.openAiModelId).toBe("gpt-4-turbo")
				}
			}
		})
	})

	describe("Config Validation", () => {
		it("should validate provider exists in config", () => {
			const providers = [
				{ id: "kilocode-1", provider: "kilocode" },
				{ id: "anthropic-main", provider: "anthropic" },
			]

			const validProvider = providers.some((p) => p.id === "kilocode-1")
			expect(validProvider).toBe(true)

			const invalidProvider = providers.some((p) => p.id === "nonexistent")
			expect(invalidProvider).toBe(false)
		})

		it("should get list of available provider IDs", () => {
			const providers = [
				{ id: "kilocode-1", provider: "kilocode" },
				{ id: "anthropic-main", provider: "anthropic" },
				{ id: "openai-1", provider: "openai" },
			]

			const availableIds = providers.map((p) => p.id)
			expect(availableIds).toEqual(["kilocode-1", "anthropic-main", "openai-1"])
		})
	})

	describe("Model Field Mapping", () => {
		it("should handle all major providers with getModelIdKey", () => {
			const providers: Array<{ name: ProviderName; expectedField: string }> = [
				{ name: "kilocode", expectedField: "kilocodeModel" },
				{ name: "anthropic", expectedField: "apiModelId" },
				{ name: "openai", expectedField: "openAiModelId" },
				{ name: "openai-native", expectedField: "apiModelId" },
				{ name: "openrouter", expectedField: "openRouterModelId" },
				{ name: "ollama", expectedField: "ollamaModelId" },
				{ name: "gemini", expectedField: "apiModelId" },
				{ name: "bedrock", expectedField: "apiModelId" },
			]

			providers.forEach(({ name, expectedField }) => {
				const field = getModelIdKey(name)
				expect(field).toBe(expectedField)
			})
		})
	})
})
