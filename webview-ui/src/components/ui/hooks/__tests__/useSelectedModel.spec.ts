// npx vitest src/components/ui/hooks/__tests__/useSelectedModel.spec.ts

import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"
import type { Mock } from "vitest"

import {
	ProviderSettings,
	ModelInfo,
	BEDROCK_1M_CONTEXT_MODEL_IDS,
	litellmDefaultModelInfo,
	openAiModelInfoSaneDefaults,
	moonshotModels,
} from "@roo-code/types"

import { useSelectedModel } from "../useSelectedModel"
import { useRouterModels } from "../useRouterModels"
import { useOpenRouterModelProviders } from "../useOpenRouterModelProviders"
import { ExtensionStateContextProvider } from "@src/context/ExtensionStateContext" // kilocode_change

vi.mock("../useRouterModels")
vi.mock("../useOpenRouterModelProviders")

const mockUseRouterModels = useRouterModels as Mock<typeof useRouterModels>
const mockUseOpenRouterModelProviders = useOpenRouterModelProviders as Mock<typeof useOpenRouterModelProviders>

const createWrapper = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	})
	// kilocode_change start: wrap with ExtensionStateContextProvider
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(
			ExtensionStateContextProvider,
			null,
			React.createElement(QueryClientProvider, { client: queryClient }, children),
		)
	// kilocode_change end
}

describe("useSelectedModel", () => {
	describe("OpenRouter provider merging", () => {
		it("should merge base model info with specific provider info when both exist", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
			}

			const specificProviderInfo: ModelInfo = {
				maxTokens: 8192, // Different value that should override
				contextWindow: 16384, // Different value that should override
				supportsImages: true, // Different value that should override
				supportsPromptCache: true, // Different value that should override
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"test-model": baseModelInfo,
					},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {
					"test-provider": specificProviderInfo,
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual({
				maxTokens: 8192, // From specific provider (overrides base)
				contextWindow: 16384, // From specific provider (overrides base)
				supportsImages: true, // From specific provider (overrides base)
				supportsPromptCache: true, // From specific provider (overrides base)
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			})
		})

		it("should fall back to default when configured model doesn't exist in available models", () => {
			const specificProviderInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 16384,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"anthropic/claude-sonnet-4.5": {
							maxTokens: 8192,
							contextWindow: 200_000,
							supportsImages: true,
							supportsPromptCache: true,
							inputPrice: 3.0,
							outputPrice: 15.0,
							cacheWritesPrice: 3.75,
							cacheReadsPrice: 0.3,
						},
					},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {
					"test-provider": specificProviderInfo,
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model", // This model doesn't exist in available models
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			// Should fall back to provider default since "test-model" doesn't exist
			expect(result.current.id).toBe("anthropic/claude-sonnet-4.5")
			// Should still use specific provider info for the default model if specified
			expect(result.current.info).toEqual({
				...{
					maxTokens: 8192,
					contextWindow: 200_000,
					supportsImages: true,
					supportsPromptCache: true,
					inputPrice: 3.0,
					outputPrice: 15.0,
					cacheWritesPrice: 3.75,
					cacheReadsPrice: 0.3,
				},
				...specificProviderInfo,
			})
		})

		it("should demonstrate the merging behavior validates the comment about missing fields", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
				cacheWritesPrice: 0.1,
				cacheReadsPrice: 0.01,
			}

			const specificProviderInfo: Partial<ModelInfo> = {
				inputPrice: 0.001,
				outputPrice: 0.002,
				description: "Provider-specific description",
				maxTokens: 8192, // Override this one
				supportsImages: true, // Override this one
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"test-model": baseModelInfo,
					},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: { "test-provider": specificProviderInfo as ModelInfo },
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
				openRouterSpecificProvider: "test-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual({
				// Fields from base model that provider doesn't have
				contextWindow: 8192, // From base (provider doesn't override)
				supportsPromptCache: false, // From base (provider doesn't override)
				cacheWritesPrice: 0.1, // From base (provider doesn't have)
				cacheReadsPrice: 0.01, // From base (provider doesn't have)

				// Fields overridden by provider
				maxTokens: 8192, // From provider (overrides base)
				supportsImages: true, // From provider (overrides base)

				// Fields only in provider
				inputPrice: 0.001, // From provider (base doesn't have)
				outputPrice: 0.002, // From provider (base doesn't have)
				description: "Provider-specific description", // From provider (base doesn't have)
			})
		})

		it("should use base model info when no specific provider is configured", () => {
			const baseModelInfo: ModelInfo = {
				maxTokens: 4096,
				contextWindow: 8192,
				supportsImages: false,
				supportsPromptCache: false,
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: { "test-model": baseModelInfo },
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "test-model",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("test-model")
			expect(result.current.info).toEqual(baseModelInfo)
		})

		it("should fall back to default when configured model and provider don't exist", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {
						"anthropic/claude-sonnet-4.5": {
							// Default model - using correct default model name
							maxTokens: 8192,
							contextWindow: 200_000,
							supportsImages: true,
							supportsPromptCache: true,
							inputPrice: 3.0,
							outputPrice: 15.0,
							cacheWritesPrice: 3.75,
							cacheReadsPrice: 0.3,
						},
					},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openrouter",
				openRouterModelId: "non-existent-model",
				openRouterSpecificProvider: "non-existent-provider",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			// Should fall back to provider default since "non-existent-model" doesn't exist
			expect(result.current.id).toBe("anthropic/claude-sonnet-4.5")
			// Should use base model info since provider doesn't exist
			expect(result.current.info).toEqual({
				maxTokens: 8192,
				contextWindow: 200_000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3.0,
				outputPrice: 15.0,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
			})
		})
	})

	describe("loading and error states", () => {
		it("should NOT set loading when router models are loading but provider is static (anthropic)", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: true,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			// With static provider default (anthropic), useSelectedModel gates router fetches, so loading should be false
			expect(result.current.isLoading).toBe(false)
		})

		it("should NOT set loading when openrouter provider metadata is loading but provider is static (anthropic)", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: true,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			// With static provider default (anthropic), openrouter providers are irrelevant, so loading should be false
			expect(result.current.isLoading).toBe(false)
		})

		it("should NOT set error when hooks error but provider is static (anthropic)", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: true,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			// Error from gated routerModels should not bubble for static provider default
			expect(result.current.isError).toBe(false)
		})
	})

	describe("default behavior", () => {
		it("should return anthropic default when no configuration is provided", () => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.provider).toBe("anthropic")
			expect(result.current.id).toBe("claude-sonnet-4-5")
			expect(result.current.info).toBeUndefined()
		})
	})

	describe("moonshot endpoint restrictions", () => {
		it("falls back to default Moonshot model when kimi-for-coding is used on non-coding endpoint", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "moonshot",
				apiModelId: "kimi-for-coding",
				moonshotBaseUrl: "https://api.moonshot.ai/v1",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			const firstNonCodingMoonshotModelId = Object.keys(moonshotModels).find((id) => id !== "kimi-for-coding")
			expect(result.current.id).toBe(firstNonCodingMoonshotModelId)
		})

		// kilocode_change start
		it("keeps non-coding model when Moonshot coding endpoint is selected", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "moonshot",
				apiModelId: "kimi-k2-thinking",
				moonshotBaseUrl: "https://api.kimi.com/coding/v1",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("kimi-k2-thinking")
		})
		// kilocode_change end

		it("keeps kimi-for-coding when Moonshot coding endpoint is selected", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "moonshot",
				apiModelId: "kimi-for-coding",
				moonshotBaseUrl: "https://api.kimi.com/coding/v1",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("kimi-for-coding")
		})
	})

	describe("claude-code provider", () => {
		it("should return claude-code model with correct model info", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "claude-code",
				apiModelId: "claude-sonnet-4-5", // Use valid claude-code model ID
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("claude-code")
			expect(result.current.id).toBe("claude-sonnet-4-5")
			expect(result.current.info).toBeDefined()
			expect(result.current.info?.supportsImages).toBe(true) // Claude Code now supports images
			expect(result.current.info?.supportsPromptCache).toBe(true) // Claude Code now supports prompt cache
			// Verify it inherits other properties from claude-code models
			expect(result.current.info?.maxTokens).toBe(32768)
			expect(result.current.info?.contextWindow).toBe(200_000)
		})

		it("should use default claude-code model when no modelId is specified", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "claude-code",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("claude-code")
			expect(result.current.id).toBe("claude-sonnet-4-5") // Default model
			expect(result.current.info).toBeDefined()
			expect(result.current.info?.supportsImages).toBe(true) // Claude Code now supports images
		})
	})

	// kilocode_change end

	describe("anthropic provider with 1M context", () => {
		beforeEach(() => {
			mockUseRouterModels.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: undefined,
				isLoading: false,
				isError: false,
			} as any)
		})

		it("should apply 1M pricing tier for Claude Sonnet 4.6 when enabled", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-6",
				anthropicBeta1MContext: true,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("claude-sonnet-4-6")
			expect(result.current.info?.contextWindow).toBe(1_000_000)
			expect(result.current.info?.inputPrice).toBe(6.0)
			expect(result.current.info?.outputPrice).toBe(22.5)
		})
	})

	describe("bedrock provider with 1M context", () => {
		beforeEach(() => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)
		})

		it("should enable 1M context window for Bedrock Claude Sonnet 4 when awsBedrock1MContext is true", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "bedrock",
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsBedrock1MContext: true,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe(BEDROCK_1M_CONTEXT_MODEL_IDS[0])
			expect(result.current.info?.contextWindow).toBe(1_000_000)
		})

		it("should use default context window for Bedrock Claude Sonnet 4 when awsBedrock1MContext is false", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "bedrock",
				apiModelId: BEDROCK_1M_CONTEXT_MODEL_IDS[0],
				awsBedrock1MContext: false,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe(BEDROCK_1M_CONTEXT_MODEL_IDS[0])
			expect(result.current.info?.contextWindow).toBe(200_000)
		})

		it("should not affect context window for non-Claude Sonnet 4 Bedrock models", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "bedrock",
				apiModelId: "anthropic.claude-3-5-sonnet-20241022-v2:0",
				awsBedrock1MContext: true,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("anthropic.claude-3-5-sonnet-20241022-v2:0")
			expect(result.current.info?.contextWindow).toBe(200_000)
		})
	})

	describe("litellm provider", () => {
		beforeEach(() => {
			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)
		})

		it("should use litellmDefaultModelInfo as fallback when routerModels.litellm is empty", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "litellm",
				litellmModelId: "some-model",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("litellm")
			// Should fall back to default model ID since "some-model" doesn't exist in empty litellm models
			expect(result.current.id).toBe("claude-3-7-sonnet-20250219")
			// Should use litellmDefaultModelInfo as fallback
			expect(result.current.info).toEqual(litellmDefaultModelInfo)
			expect(result.current.info?.supportsNativeTools).toBe(true)
		})

		it("should use litellmDefaultModelInfo when selected model not found in routerModels", () => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {
						"existing-model": {
							maxTokens: 4096,
							contextWindow: 8192,
							supportsImages: false,
							supportsPromptCache: false,
							supportsNativeTools: true,
						},
					},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "litellm",
				litellmModelId: "non-existing-model",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("litellm")
			// Falls back to default model ID
			expect(result.current.id).toBe("claude-3-7-sonnet-20250219")
			// Should use litellmDefaultModelInfo as fallback since default model also not in router models
			expect(result.current.info).toEqual(litellmDefaultModelInfo)
			expect(result.current.info?.supportsNativeTools).toBe(true)
		})

		it("should merge only native tool defaults with routerModels when model exists", () => {
			const customModelInfo: ModelInfo = {
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: true,
				supportsNativeTools: true,
				description: "Custom LiteLLM model",
			}

			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {
						"custom-model": customModelInfo,
					},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			const apiConfiguration: ProviderSettings = {
				apiProvider: "litellm",
				litellmModelId: "custom-model",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("litellm")
			expect(result.current.id).toBe("custom-model")
			// Should only merge native tool defaults, not prices or other model-specific info
			// Router model values override the defaults
			const nativeToolDefaults = {
				supportsNativeTools: litellmDefaultModelInfo.supportsNativeTools,
				defaultToolProtocol: litellmDefaultModelInfo.defaultToolProtocol,
			}
			expect(result.current.info).toEqual({ ...nativeToolDefaults, ...customModelInfo })
			expect(result.current.info?.supportsNativeTools).toBe(true)
			expect(result.current.info?.defaultToolProtocol).toBe("native")
		})
	})

	describe("openai provider", () => {
		beforeEach(() => {
			mockUseRouterModels.mockReturnValue({
				data: {
					openrouter: {},
					"vercel-ai-gateway": {},
					huggingface: {},
					litellm: {},
					apertis: {},
					kilocode: {},
					ovhcloud: {},
					gemini: {},
					inception: {},
					synthetic: {},
					"sap-ai-core": {},
					zenmux: {},
					deepinfra: {},
					"io-intelligence": {},
					requesty: {},
					unbound: {},
					glama: {},
					roo: {},
					chutes: {},
					"nano-gpt": {},
					ollama: {},
					lmstudio: {},
				},
				isLoading: false,
				isError: false,
			} as any)

			mockUseOpenRouterModelProviders.mockReturnValue({
				data: {},
				isLoading: false,
				isError: false,
			} as any)
		})

		it("should use openAiModelInfoSaneDefaults when no custom model info is provided", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4o",
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("openai")
			expect(result.current.id).toBe("gpt-4o")
			expect(result.current.info).toEqual(openAiModelInfoSaneDefaults)
			expect(result.current.info?.supportsNativeTools).toBe(true)
			expect(result.current.info?.defaultToolProtocol).toBe("native")
		})

		it("should merge native tool defaults with custom model info", () => {
			const customModelInfo: ModelInfo = {
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: true,
				supportsPromptCache: false,
				inputPrice: 0.01,
				outputPrice: 0.03,
				description: "Custom OpenAI-compatible model",
			}

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "custom-model",
				openAiCustomModelInfo: customModelInfo,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("openai")
			expect(result.current.id).toBe("custom-model")
			// Should merge native tool defaults with custom model info
			const nativeToolDefaults = {
				supportsNativeTools: openAiModelInfoSaneDefaults.supportsNativeTools,
				defaultToolProtocol: openAiModelInfoSaneDefaults.defaultToolProtocol,
			}
			expect(result.current.info).toEqual({ ...nativeToolDefaults, ...customModelInfo })
			expect(result.current.info?.supportsNativeTools).toBe(true)
			expect(result.current.info?.defaultToolProtocol).toBe("native")
		})

		it("should allow custom model info to override native tool defaults", () => {
			const customModelInfo: ModelInfo = {
				maxTokens: 8192,
				contextWindow: 32000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsNativeTools: false, // Explicitly disable
				defaultToolProtocol: "xml", // Override default to use XML instead of native
			}

			const apiConfiguration: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "custom-model-no-tools",
				openAiCustomModelInfo: customModelInfo,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.provider).toBe("openai")
			expect(result.current.id).toBe("custom-model-no-tools")
			// Custom model info should override the native tool defaults
			expect(result.current.info?.supportsNativeTools).toBe(false)
			expect(result.current.info?.defaultToolProtocol).toBe("xml")
		})
	})
})
