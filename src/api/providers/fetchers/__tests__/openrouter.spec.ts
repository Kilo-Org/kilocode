// npx vitest run api/providers/fetchers/__tests__/openrouter.spec.ts

import * as path from "path"

import { back as nockBack } from "nock"

import { getOpenRouterModelEndpoints, getOpenRouterModels, parseOpenRouterModel } from "../openrouter"

nockBack.fixtures = path.join(__dirname, "fixtures")
nockBack.setMode("lockdown")

describe("OpenRouter API", () => {
	describe("getOpenRouterModels", () => {
		// kilocode_change: skip, this test uses "nock", which works with axios, but with fetch it truncates responses for unclear reasons
		it.skip("fetches models and validates schema", async () => {
			const { nockDone } = await nockBack("openrouter-models.json")

			const models = await getOpenRouterModels()

			expect(models["anthropic/claude-3.7-sonnet"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				displayName: expect.any(String), // kilocode_change
				supportsReasoningBudget: false,
				supportsReasoningEffort: false,
				supportsNativeTools: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
				defaultToolProtocol: "native",
			})

			expect(models["anthropic/claude-3.7-sonnet:thinking"]).toEqual({
				maxTokens: 128000,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: expect.any(String),
				displayName: expect.any(String), // kilocode_change
				supportsReasoningBudget: true,
				requiredReasoningBudget: true,
				supportsReasoningEffort: true,
				supportsNativeTools: true,
				supportedParameters: ["max_tokens", "temperature", "reasoning", "include_reasoning"],
				defaultToolProtocol: "native",
			})

			expect(models["google/gemini-2.5-flash-preview-05-20"].maxTokens).toEqual(65535)

			const anthropicModels = Object.entries(models)
				.filter(([id, _]) => id.startsWith("anthropic/claude-3"))
				.map(([id, model]) => ({ id, maxTokens: model.maxTokens }))
				.sort(({ id: a }, { id: b }) => a.localeCompare(b))

			expect(anthropicModels).toEqual([
				{ id: "anthropic/claude-3-haiku", maxTokens: 4096 },
				{ id: "anthropic/claude-3-haiku:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus", maxTokens: 4096 },
				{ id: "anthropic/claude-3-opus:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet", maxTokens: 4096 },
				{ id: "anthropic/claude-3-sonnet:beta", maxTokens: 4096 },
				{ id: "anthropic/claude-3.5-haiku", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku-20241022:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-haiku:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet-20240620:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.5-sonnet:beta", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet", maxTokens: 8192 },
				{ id: "anthropic/claude-3.7-sonnet:beta", maxTokens: 128000 },
				{ id: "anthropic/claude-3.7-sonnet:thinking", maxTokens: 128000 },
			])

			nockDone()
		})
	})

	describe("getOpenRouterModelEndpoints", () => {
		it("fetches model endpoints and validates schema", async () => {
			const mockEndpointsResponse = {
				data: {
					data: {
						id: "google/gemini-2.5-pro-preview",
						name: "Gemini 2.5 Pro Preview",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						endpoints: [
							{
								provider_name: "Google Vertex",
								tag: "google-vertex",
								context_length: 1048576,
								max_completion_tokens: 65535,
								pricing: {
									prompt: "0.00000125",
									completion: "0.00001",
									input_cache_write: "0.000001625",
									input_cache_read: "0.00000031",
								},
							},
							{
								provider_name: "Google AI Studio",
								tag: "google-ai-studio",
								context_length: 1048576,
								max_completion_tokens: 65536,
								pricing: {
									prompt: "0.00000125",
									completion: "0.00001",
									input_cache_write: "0.000001625",
									input_cache_read: "0.00000031",
								},
							},
						],
					},
				},
			}

			// Mock cached parent model data
			const mockCachedModels = {
				"google/gemini-2.5-pro-preview": {
					maxTokens: 65536,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					supportsReasoningEffort: true,
					supportsNativeTools: false, // Gemini doesn't support native tools via "tools" parameter
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			} as Record<string, any>

			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue(mockEndpointsResponse)

			const endpoints = await getOpenRouterModelEndpoints("google/gemini-2.5-pro-preview")

			// Simulate what modelEndpointCache does - copy capabilities from parent
			const parentModel = mockCachedModels["google/gemini-2.5-pro-preview"]
			if (parentModel) {
				for (const key of Object.keys(endpoints)) {
					endpoints[key].supportsNativeTools = parentModel.supportsNativeTools
					endpoints[key].supportsReasoningEffort = parentModel.supportsReasoningEffort
					endpoints[key].supportedParameters = parentModel.supportedParameters
				}
			}

			expect(endpoints).toEqual({
				"google-vertex": {
					maxTokens: 65535,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: true,
					supportsNativeTools: false, // Copied from parent model
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
				"google-ai-studio": {
					maxTokens: 65536,
					contextWindow: 1048576,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 1.25,
					outputPrice: 10,
					cacheWritesPrice: 1.625,
					cacheReadsPrice: 0.31,
					description: undefined,
					supportsReasoningEffort: true,
					supportsNativeTools: false, // Copied from parent model
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			})

			getSpy.mockRestore()
		})

		it("copies model-level capabilities from parent model to endpoint models", async () => {
			const mockEndpointsResponse = {
				data: {
					data: {
						id: "anthropic/claude-sonnet-4",
						name: "Claude Sonnet 4",
						description: "Latest Claude model",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						endpoints: [
							{
								provider_name: "Anthropic",
								name: "Claude Sonnet 4",
								context_length: 200000,
								max_completion_tokens: 8192,
								pricing: {
									prompt: "0.000003",
									completion: "0.000015",
									input_cache_write: "0.00000375",
									input_cache_read: "0.0000003",
								},
							},
						],
					},
				},
			}

			// Mock cached parent model with native tools support
			const mockCachedModels = {
				"anthropic/claude-sonnet-4": {
					maxTokens: 8192,
					contextWindow: 200000,
					supportsImages: true,
					supportsPromptCache: true,
					supportsReasoningBudget: true,
					inputPrice: 3,
					outputPrice: 15,
					cacheWritesPrice: 3.75,
					cacheReadsPrice: 0.3,
					supportsReasoningEffort: true,
					supportsNativeTools: true, // Anthropic supports native tools
					supportedParameters: ["max_tokens", "temperature", "reasoning"],
				},
			} as Record<string, any>

			const axios = await import("axios")
			const getSpy = vi.spyOn(axios.default, "get").mockResolvedValue(mockEndpointsResponse)

			const endpoints = await getOpenRouterModelEndpoints("anthropic/claude-sonnet-4")

			// Simulate what modelEndpointCache does - copy capabilities from parent
			const parentModel = mockCachedModels["anthropic/claude-sonnet-4"]
			if (parentModel) {
				for (const key of Object.keys(endpoints)) {
					endpoints[key].supportsNativeTools = parentModel.supportsNativeTools
					endpoints[key].supportsReasoningEffort = parentModel.supportsReasoningEffort
					endpoints[key].supportedParameters = parentModel.supportedParameters
				}
			}

			expect(endpoints["Anthropic"]).toEqual({
				maxTokens: 8192,
				contextWindow: 200000,
				supportsImages: true,
				supportsPromptCache: true,
				inputPrice: 3,
				outputPrice: 15,
				cacheWritesPrice: 3.75,
				cacheReadsPrice: 0.3,
				description: undefined,
				supportsReasoningBudget: true,
				supportsReasoningEffort: true,
				supportsNativeTools: true, // Copied from parent model
				supportedParameters: ["max_tokens", "temperature", "reasoning"],
			})

			getSpy.mockRestore()
		})
	})

	describe("parseOpenRouterModel", () => {
		it("sets horizon-alpha model to 32k max tokens", () => {
			const mockModel = {
				name: "Horizon Alpha",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 128000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/horizon-alpha",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 128000,
			})

			expect(result.maxTokens).toBe(32768)
			expect(result.contextWindow).toBe(128000)
		})

		it("sets horizon-beta model to 32k max tokens", () => {
			const mockModel = {
				name: "Horizon Beta",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 128000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/horizon-beta",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 128000,
			})

			expect(result.maxTokens).toBe(32768)
			expect(result.contextWindow).toBe(128000)
		})

		it("does not override max tokens for other models", () => {
			const mockModel = {
				name: "Other Model",
				description: "Test model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const result = parseOpenRouterModel({
				id: "openrouter/other-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 64000,
			})

			expect(result.maxTokens).toBe(64000)
			expect(result.contextWindow).toBe(128000)
		})

		it("filters out image generation models", () => {
			const mockImageModel = {
				name: "Image Model",
				description: "Test image generation model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const mockTextModel = {
				name: "Text Model",
				description: "Test text generation model",
				context_length: 128000,
				max_completion_tokens: 64000,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			// Model with image output should be filtered out - we only test parseOpenRouterModel
			// since the filtering happens in getOpenRouterModels/getOpenRouterModelEndpoints
			const textResult = parseOpenRouterModel({
				id: "test/text-model",
				model: mockTextModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 64000,
			})

			const imageResult = parseOpenRouterModel({
				id: "test/image-model",
				model: mockImageModel,
				inputModality: ["text"],
				outputModality: ["image"],
				maxTokens: 64000,
			})

			// Both should parse successfully (filtering happens at a higher level)
			expect(textResult.maxTokens).toBe(64000)
			expect(imageResult.maxTokens).toBe(64000)
		})

		it("sets defaultToolProtocol to native when model supports native tools", () => {
			const mockModel = {
				name: "Tools Model",
				description: "Model with native tool support",
				context_length: 128000,
				max_completion_tokens: 8192,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const resultWithTools = parseOpenRouterModel({
				id: "test/tools-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
				supportedParameters: ["tools", "max_tokens", "temperature"],
			})

			expect(resultWithTools.supportsNativeTools).toBe(true)
			expect(resultWithTools.defaultToolProtocol).toBe("native")
		})

		it("does not set defaultToolProtocol when model does not support native tools", () => {
			const mockModel = {
				name: "No Tools Model",
				description: "Model without native tool support",
				context_length: 128000,
				max_completion_tokens: 8192,
				pricing: {
					prompt: "0.000003",
					completion: "0.000015",
				},
			}

			const resultWithoutTools = parseOpenRouterModel({
				id: "test/no-tools-model",
				model: mockModel,
				inputModality: ["text"],
				outputModality: ["text"],
				maxTokens: 8192,
				supportedParameters: ["max_tokens", "temperature"],
			})

			expect(resultWithoutTools.supportsNativeTools).toBe(false)
			expect(resultWithoutTools.defaultToolProtocol).toBeUndefined()
		})
	})
})
