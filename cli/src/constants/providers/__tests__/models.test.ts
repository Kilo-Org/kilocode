/**
 * Tests for static provider model implementations
 * Tests the new functionality where models are imported from @roo-code/types
 */

import { describe, it, expect } from "vitest"
import {
	getModelsByProvider,
	DEFAULT_MODEL_IDS,
	PROVIDER_TO_ROUTER_NAME,
	providerSupportsModelList,
	getRouterNameForProvider,
	getModelFieldForProvider,
	getCurrentModelId,
	sortModelsByPreference,
	formatPrice,
	formatModelInfo,
	fuzzyFilterModels,
	prettyModelName,
	type RouterModels,
	type ModelRecord,
} from "../models.js"
import type { ProviderName } from "../../../types/messages.js"
import type { ProviderConfig } from "../../../config/types.js"

describe("Static Provider Models", () => {
	describe("getModelsByProvider - Static Providers", () => {
		const staticProviders: ProviderName[] = [
			"anthropic",
			"bedrock",
			"vertex",
			"openai-native",
			"mistral",
			"moonshot",
			"deepseek",
			"doubao",
			"qwen-code",
			"xai",
			"groq",
			"cerebras",
			"sambanova",
			"zai",
			"minimax",
			"fireworks",
			"featherless",
			"claude-code",
			"gemini-cli",
		]

		it.each(staticProviders)("should return non-empty models for %s provider", (provider) => {
			const result = getModelsByProvider({
				provider,
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toBeDefined()
			expect(Object.keys(result.models).length).toBeGreaterThan(0)
			expect(result.defaultModel).toBeTruthy()
		})

		describe("Anthropic provider", () => {
			it("should return anthropic models with correct structure", () => {
				const result = getModelsByProvider({
					provider: "anthropic",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models).toBeDefined()
				expect(result.defaultModel).toBe("claude-sonnet-4-5")

				// Verify at least one model has expected properties
				const firstModelId = Object.keys(result.models)[0]
				const firstModel = result.models[firstModelId]
				expect(firstModel).toHaveProperty("contextWindow")
				expect(firstModel).toHaveProperty("supportsPromptCache")
				expect(typeof firstModel.contextWindow).toBe("number")
				expect(typeof firstModel.supportsPromptCache).toBe("boolean")
			})

			it("should have valid default model ID in models object", () => {
				const result = getModelsByProvider({
					provider: "anthropic",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models[result.defaultModel]).toBeDefined()
			})

			it("should include pricing information", () => {
				const result = getModelsByProvider({
					provider: "anthropic",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				const modelWithPricing = Object.values(result.models).find(
					(model) => model.inputPrice !== undefined && model.outputPrice !== undefined,
				)
				expect(modelWithPricing).toBeDefined()
				expect(typeof modelWithPricing?.inputPrice).toBe("number")
				expect(typeof modelWithPricing?.outputPrice).toBe("number")
			})
		})

		describe("Gemini provider", () => {
			it("should return gemini models with correct default", () => {
				const result = getModelsByProvider({
					provider: "gemini",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models).toBeDefined()
				expect(result.defaultModel).toBe("gemini-3-pro-preview") // kilocode_change
				expect(result.models[result.defaultModel]).toBeDefined()
			})

			it("should have models with large context windows", () => {
				const result = getModelsByProvider({
					provider: "gemini",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				const largeContextModel = Object.values(result.models).find((model) => model.contextWindow >= 1_000_000)
				expect(largeContextModel).toBeDefined()
			})
		})

		describe("XAI provider", () => {
			it("should return xai models with correct default", () => {
				const result = getModelsByProvider({
					provider: "xai",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models).toBeDefined()
				expect(result.defaultModel).toBe("grok-code-fast-1")
				expect(result.models[result.defaultModel]).toBeDefined()
			})

			it("should include grok models", () => {
				const result = getModelsByProvider({
					provider: "xai",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				const grokModels = Object.keys(result.models).filter((id) => id.includes("grok"))
				expect(grokModels.length).toBeGreaterThan(0)
			})
		})

		describe("Groq provider", () => {
			it("should return groq models with correct structure", () => {
				const result = getModelsByProvider({
					provider: "groq",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models).toBeDefined()
				expect(result.defaultModel).toBeTruthy()
				expect(result.models[result.defaultModel]).toBeDefined()
			})
		})

		describe("Mistral provider", () => {
			it("should return mistral models with correct structure", () => {
				const result = getModelsByProvider({
					provider: "mistral",
					routerModels: null,
					kilocodeDefaultModel: "",
				})

				expect(result.models).toBeDefined()
				expect(result.defaultModel).toBeTruthy()
				expect(result.models[result.defaultModel]).toBeDefined()
			})
		})
	})

	describe("getModelsByProvider - Router-based Providers (Regression)", () => {
		const mockRouterModels: RouterModels = {
			openrouter: {
				"gpt-4": {
					contextWindow: 8192,
					supportsPromptCache: false,
					inputPrice: 30,
					outputPrice: 60,
				},
				"claude-sonnet-4.5": {
					contextWindow: 200000,
					supportsPromptCache: true,
					inputPrice: 3,
					outputPrice: 15,
				},
			},
			ollama: {
				llama2: {
					contextWindow: 4096,
					supportsPromptCache: false,
				},
			},
			lmstudio: {},
			litellm: {},
			glama: {},
			unbound: {},
			requesty: {},
			kilocode: {},
			"io-intelligence": {},
			deepinfra: {},
			"vercel-ai-gateway": {},
			ovhcloud: {},
		}

		it("should return router models for openrouter provider", () => {
			const result = getModelsByProvider({
				provider: "openrouter",
				routerModels: mockRouterModels,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toBe(mockRouterModels.openrouter)
			expect(result.defaultModel).toBe("anthropic/claude-sonnet-4.5")
		})

		it("should return router models for ollama provider", () => {
			const result = getModelsByProvider({
				provider: "ollama",
				routerModels: mockRouterModels,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toBe(mockRouterModels.ollama)
			expect(Object.keys(result.models)).toContain("llama2")
		})

		it("should use kilocodeDefaultModel for kilocode provider", () => {
			const kilocodeDefaultModel = "test-model-id"
			const result = getModelsByProvider({
				provider: "kilocode",
				routerModels: mockRouterModels,
				kilocodeDefaultModel,
			})

			expect(result.defaultModel).toBe(kilocodeDefaultModel)
		})

		it("should handle empty router models gracefully", () => {
			const result = getModelsByProvider({
				provider: "lmstudio",
				routerModels: mockRouterModels,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toBeDefined()
			expect(Object.keys(result.models).length).toBe(0)
		})
	})

	describe("getModelsByProvider - Edge Cases", () => {
		it("should handle null routerModels for router-based provider", () => {
			const result = getModelsByProvider({
				provider: "openrouter",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			// Should fall back to empty models
			expect(result.models).toEqual({})
			expect(result.defaultModel).toBe("anthropic/claude-sonnet-4.5")
		})

		it("should handle providers without static models", () => {
			const result = getModelsByProvider({
				provider: "vscode-lm",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toEqual({})
			expect(result.defaultModel).toBe("gpt-3.5-turbo")
		})

		it("should handle human-relay provider", () => {
			const result = getModelsByProvider({
				provider: "human-relay",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toEqual({})
			expect(result.defaultModel).toBe("")
		})

		it("should handle fake-ai provider", () => {
			const result = getModelsByProvider({
				provider: "fake-ai",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result.models).toEqual({})
			expect(result.defaultModel).toBe("")
		})
	})

	describe("DEFAULT_MODEL_IDS", () => {
		it("should have default model IDs for all static providers", () => {
			const staticProviders: ProviderName[] = [
				"anthropic",
				"bedrock",
				"vertex",
				"gemini",
				"deepseek",
				"openai-native",
				"mistral",
				"xai",
				"groq",
				"chutes",
				"cerebras",
			]

			staticProviders.forEach((provider) => {
				expect(DEFAULT_MODEL_IDS[provider]).toBeDefined()
				expect(DEFAULT_MODEL_IDS[provider]).toBeTruthy()
			})
		})

		it("should have matching default IDs with getModelsByProvider results", () => {
			const result = getModelsByProvider({
				provider: "anthropic",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result.defaultModel).toBe(DEFAULT_MODEL_IDS.anthropic)
		})
	})

	describe("PROVIDER_TO_ROUTER_NAME", () => {
		it("should map router-based providers to router names", () => {
			expect(PROVIDER_TO_ROUTER_NAME.openrouter).toBe("openrouter")
			expect(PROVIDER_TO_ROUTER_NAME.ollama).toBe("ollama")
			expect(PROVIDER_TO_ROUTER_NAME.litellm).toBe("litellm")
		})

		it("should map static providers to null", () => {
			expect(PROVIDER_TO_ROUTER_NAME.anthropic).toBeNull()
			expect(PROVIDER_TO_ROUTER_NAME.gemini).toBeNull()
			expect(PROVIDER_TO_ROUTER_NAME.xai).toBeNull()
			expect(PROVIDER_TO_ROUTER_NAME.groq).toBeNull()
			expect(PROVIDER_TO_ROUTER_NAME.mistral).toBeNull()
		})
	})

	describe("providerSupportsModelList", () => {
		it("should return true for router-based providers", () => {
			expect(providerSupportsModelList("openrouter")).toBe(true)
			expect(providerSupportsModelList("ollama")).toBe(true)
			expect(providerSupportsModelList("litellm")).toBe(true)
		})

		it("should return false for static providers", () => {
			expect(providerSupportsModelList("anthropic")).toBe(false)
			expect(providerSupportsModelList("gemini")).toBe(false)
			expect(providerSupportsModelList("xai")).toBe(false)
			expect(providerSupportsModelList("groq")).toBe(false)
		})
	})

	describe("getRouterNameForProvider", () => {
		it("should return router name for router-based providers", () => {
			expect(getRouterNameForProvider("openrouter")).toBe("openrouter")
			expect(getRouterNameForProvider("ollama")).toBe("ollama")
		})

		it("should return null for static providers", () => {
			expect(getRouterNameForProvider("anthropic")).toBeNull()
			expect(getRouterNameForProvider("gemini")).toBeNull()
		})
	})

	describe("getModelFieldForProvider", () => {
		it("should return correct field names for router providers", () => {
			expect(getModelFieldForProvider("openrouter")).toBe("openRouterModelId")
			expect(getModelFieldForProvider("ollama")).toBe("ollamaModelId")
		})

		it("should return null for static providers", () => {
			expect(getModelFieldForProvider("anthropic")).toBeNull()
			expect(getModelFieldForProvider("gemini")).toBeNull()
		})
	})

	describe("getCurrentModelId", () => {
		it("should return model ID from provider config", () => {
			const providerConfig: ProviderConfig = {
				id: "test",
				provider: "anthropic",
				apiModelId: "claude-3-opus-20240229",
			}

			const result = getCurrentModelId({
				providerConfig,
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result).toBe("claude-3-opus-20240229")
		})

		it("should return default model when no model ID in config", () => {
			const providerConfig: ProviderConfig = {
				id: "test",
				provider: "anthropic",
			}

			const result = getCurrentModelId({
				providerConfig,
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result).toBe("claude-sonnet-4-5")
		})

		it("should handle vscode-lm provider with selector", () => {
			const providerConfig: ProviderConfig = {
				id: "test",
				provider: "vscode-lm",
				vsCodeLmModelSelector: {
					vendor: "copilot",
					family: "gpt-4",
				},
			}

			const result = getCurrentModelId({
				providerConfig,
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			expect(result).toBe("copilot/gpt-4")
		})
	})

	describe("sortModelsByPreference", () => {
		it("should sort models with preferredIndex first", () => {
			const models: ModelRecord = {
				"model-a": {
					contextWindow: 8192,
					supportsPromptCache: false,
					preferredIndex: 2,
				},
				"model-b": {
					contextWindow: 8192,
					supportsPromptCache: false,
					preferredIndex: 0,
				},
				"model-c": {
					contextWindow: 8192,
					supportsPromptCache: false,
				},
			}

			const sorted = sortModelsByPreference(models)

			expect(sorted[0]).toBe("model-b")
			expect(sorted[1]).toBe("model-a")
			expect(sorted[2]).toBe("model-c")
		})

		it("should sort non-preferred models alphabetically", () => {
			const models: ModelRecord = {
				zebra: {
					contextWindow: 8192,
					supportsPromptCache: false,
				},
				alpha: {
					contextWindow: 8192,
					supportsPromptCache: false,
				},
				beta: {
					contextWindow: 8192,
					supportsPromptCache: false,
				},
			}

			const sorted = sortModelsByPreference(models)

			expect(sorted).toEqual(["alpha", "beta", "zebra"])
		})
	})

	describe("formatPrice", () => {
		it("should format price correctly", () => {
			expect(formatPrice(3.0)).toBe("$3.00")
			expect(formatPrice(15.5)).toBe("$15.50")
			expect(formatPrice(0.25)).toBe("$0.25")
		})

		it("should handle undefined price", () => {
			expect(formatPrice(undefined)).toBe("N/A")
		})

		it("should handle null price", () => {
			expect(formatPrice(null as unknown as number)).toBe("N/A")
		})
	})

	describe("formatModelInfo", () => {
		it("should format model info with all details", () => {
			const model = {
				contextWindow: 200000,
				supportsPromptCache: true,
				supportsImages: true,
				supportsComputerUse: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
			}

			const formatted = formatModelInfo("test-model", model)

			expect(formatted).toContain("200K context")
			expect(formatted).toContain("$3.00/$15.00")
			expect(formatted).toContain("Images")
			expect(formatted).toContain("Computer Use")
			expect(formatted).toContain("Cache")
		})

		it("should handle model without pricing", () => {
			const model = {
				contextWindow: 8192,
				supportsPromptCache: false,
			}

			const formatted = formatModelInfo("test-model", model)

			expect(formatted).toContain("8K context")
			expect(formatted).not.toContain("$")
		})
	})

	describe("fuzzyFilterModels", () => {
		const models: ModelRecord = {
			"gpt-4": {
				contextWindow: 8192,
				supportsPromptCache: false,
				displayName: "GPT-4",
			},
			"gpt-3.5-turbo": {
				contextWindow: 4096,
				supportsPromptCache: false,
				displayName: "GPT-3.5 Turbo",
			},
			"claude-sonnet-4.5": {
				contextWindow: 200000,
				supportsPromptCache: true,
				displayName: "Claude Sonnet 4.5",
			},
		}

		it("should return all models when filter is empty", () => {
			const filtered = fuzzyFilterModels(models, "")

			expect(filtered.length).toBe(3)
		})

		it("should filter by model ID", () => {
			const filtered = fuzzyFilterModels(models, "gpt")

			expect(filtered).toContain("gpt-4")
			expect(filtered).toContain("gpt-3.5-turbo")
			expect(filtered).not.toContain("claude-sonnet-4.5")
		})

		it("should filter by display name", () => {
			const filtered = fuzzyFilterModels(models, "claude")

			expect(filtered).toContain("claude-sonnet-4.5")
			expect(filtered).not.toContain("gpt-4")
		})

		it("should be case insensitive", () => {
			const filtered = fuzzyFilterModels(models, "GPT")

			expect(filtered.length).toBe(2)
		})
	})

	describe("prettyModelName", () => {
		it("should remove common prefixes", () => {
			expect(prettyModelName("anthropic.claude-3-opus")).toBe("Claude 3 Opus")
			expect(prettyModelName("deepseek-ai/DeepSeek-R1")).toBe("DeepSeek R1")
		})

		it("should convert dashes to spaces", () => {
			expect(prettyModelName("gpt-4-turbo")).toBe("Gpt 4 Turbo")
		})

		it("should capitalize words", () => {
			expect(prettyModelName("claude-sonnet")).toBe("Claude Sonnet")
		})
	})

	describe("Model Properties Validation", () => {
		it("should have required properties for anthropic models", () => {
			const result = getModelsByProvider({
				provider: "anthropic",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			Object.entries(result.models).forEach(([_modelId, model]) => {
				expect(model.contextWindow).toBeDefined()
				expect(typeof model.contextWindow).toBe("number")
				expect(model.contextWindow).toBeGreaterThan(0)

				expect(model.supportsPromptCache).toBeDefined()
				expect(typeof model.supportsPromptCache).toBe("boolean")
			})
		})

		it("should have valid pricing when present", () => {
			const result = getModelsByProvider({
				provider: "xai",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			Object.entries(result.models).forEach(([_modelId, model]) => {
				if (model.inputPrice !== undefined) {
					expect(typeof model.inputPrice).toBe("number")
					expect(model.inputPrice).toBeGreaterThanOrEqual(0)
				}
				if (model.outputPrice !== undefined) {
					expect(typeof model.outputPrice).toBe("number")
					expect(model.outputPrice).toBeGreaterThanOrEqual(0)
				}
			})
		})

		it("should have valid maxTokens when present", () => {
			const result = getModelsByProvider({
				provider: "gemini",
				routerModels: null,
				kilocodeDefaultModel: "",
			})

			Object.entries(result.models).forEach(([_modelId, model]) => {
				if (model.maxTokens !== undefined && model.maxTokens !== null) {
					expect(typeof model.maxTokens).toBe("number")
					expect(model.maxTokens).toBeGreaterThan(0)
				}
			})
		})
	})
})
