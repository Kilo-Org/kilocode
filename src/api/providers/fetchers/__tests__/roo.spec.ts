import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getRooModels } from "../roo"
import { Package } from "../../../../shared/package"

// Mock fetch globally
const mockFetch = vi.fn()
global.fetch = mockFetch as any

describe("getRooModels", () => {
	const baseUrl = "https://api.roocode.com/proxy"
	const apiKey = "test-api-key"

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()
	})

	afterEach(() => {
		vi.useRealTimers()
	})

	it("should fetch and parse models successfully", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "xai/grok-code-fast-1",
					object: "model",
					created: 1234567890,
					owned_by: "xai",
					name: "Grok Code Fast 1",
					description: "Fast coding model",
					context_window: 262144,
					max_tokens: 16384,
					type: "language",
					tags: ["vision", "reasoning"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
						input_cache_read: "0.00005",
						input_cache_write: "0.0001",
					},
					deprecated: false,
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.roocode.com/proxy/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					"Content-Type": "application/json",
					Authorization: `Bearer ${apiKey}`,
				}),
			}),
		)

		expect(models).toEqual({
			"xai/grok-code-fast-1": {
				maxTokens: 16384,
				contextWindow: 262144,
				supportsImages: true,
				supportsReasoningEffort: true,
				requiredReasoningEffort: false,
				supportsNativeTools: false,
				supportsPromptCache: true,
				inputPrice: 100, // 0.0001 * 1_000_000
				outputPrice: 200, // 0.0002 * 1_000_000
				cacheWritesPrice: 100, // 0.0001 * 1_000_000
				cacheReadsPrice: 50, // 0.00005 * 1_000_000
				description: "Fast coding model",
				deprecated: false,
				isFree: false,
				defaultToolProtocol: "native",
			},
		})
	})

	it("should handle reasoning-required tag", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/reasoning-required-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Reasoning Required Model",
					description: "Model that requires reasoning",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["reasoning", "reasoning-required"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/reasoning-required-model"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsReasoningEffort: true,
			requiredReasoningEffort: true,
			supportsNativeTools: false,
			supportsPromptCache: false,
			inputPrice: 100, // 0.0001 * 1_000_000
			outputPrice: 200, // 0.0002 * 1_000_000
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
			description: "Model that requires reasoning",
			deprecated: false,
			isFree: false,
			defaultTemperature: undefined,
			defaultToolProtocol: "native",
			isStealthModel: undefined,
		})
	})

	it("should handle models without required_reasoning_effort field", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/normal-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Normal Model",
					description: "Normal model without reasoning",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/normal-model"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsReasoningEffort: false,
			requiredReasoningEffort: false,
			supportsNativeTools: false,
			supportsPromptCache: false,
			inputPrice: 100, // 0.0001 * 1_000_000
			outputPrice: 200, // 0.0002 * 1_000_000
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
			description: "Normal model without reasoning",
			deprecated: false,
			isFree: false,
			defaultTemperature: undefined,
			defaultToolProtocol: "native",
			isStealthModel: undefined,
		})
	})

	it("should work without API key", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/public-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Public Model",
					description: "Public model",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl)

		expect(mockFetch).toHaveBeenCalledWith(
			"https://api.roocode.com/proxy/v1/models",
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.anything(),
				}),
			}),
		)

		expect(models["test/public-model"]).toBeDefined()
	})

	it("should handle HTTP errors", async () => {
		mockFetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: "Unauthorized",
		})

		await expect(getRooModels(baseUrl, apiKey)).rejects.toThrow(
			"Failed to fetch Roo Code Cloud models: HTTP 401: Unauthorized",
		)
	})

	it("should handle timeout", async () => {
		const abortError = new Error("AbortError")
		abortError.name = "AbortError"

		mockFetch.mockRejectedValueOnce(abortError)

		await expect(getRooModels(baseUrl, apiKey)).rejects.toThrow(
			"Failed to fetch Roo Code Cloud models: Request timed out",
		)
	})

	it("should handle invalid response format", async () => {
		const invalidResponse = {
			invalid: "data",
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => invalidResponse,
		})

		await expect(getRooModels(baseUrl, apiKey)).rejects.toThrow(
			"Failed to fetch Roo Code Cloud models: Unexpected response format",
		)
	})

	it("should normalize base URL correctly", async () => {
		const mockResponse = {
			object: "list",
			data: [],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		await getRooModels("https://api.roocode.com/proxy/v1", apiKey)

		expect(mockFetch).toHaveBeenCalledWith("https://api.roocode.com/proxy/v1/models", expect.any(Object))
	})

	it("should handle deprecated models", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/deprecated-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Deprecated Model",
					description: "Old model",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					deprecated: true,
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/deprecated-model"].deprecated).toBe(true)
	})

	it("should detect vision support from tags", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/vision-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Vision Model",
					description: "Model with vision",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["vision"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/vision-model"].supportsImages).toBe(true)
	})

	it("should detect reasoning support from tags", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/reasoning-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Reasoning Model",
					description: "Model with reasoning",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["reasoning"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/reasoning-model"].supportsReasoningEffort).toBe(true)
	})

	it("should handle models with cache pricing", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/cache-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Cache Model",
					description: "Model with cache",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
						input_cache_read: "0.00005",
						input_cache_write: "0.0001",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/cache-model"].supportsPromptCache).toBe(true)
		expect(models["test/cache-model"].cacheReadsPrice).toBe(50) // 0.00005 * 1_000_000
		expect(models["test/cache-model"].cacheWritesPrice).toBe(100) // 0.0001 * 1_000_000
	})

	it("should skip models without ID", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Invalid Model",
					description: "Model without ID",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(Object.keys(models)).toHaveLength(0)
	})

	it("should use model name as description fallback", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/no-description",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model Name",
					description: "",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/no-description"].description).toBe("Model Name")
	})

	it("should handle network errors", async () => {
		mockFetch.mockRejectedValueOnce(new TypeError("Network error"))

		await expect(getRooModels(baseUrl, apiKey)).rejects.toThrow(
			"Failed to fetch Roo Code Cloud models: No response from server",
		)
	})

	it("should parse default_temperature from API response", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/model-with-temp",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model with Default Temperature",
					description: "Model with custom default temperature",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					default_temperature: 0.6,
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/model-with-temp"].defaultTemperature).toBe(0.6)
	})

	it("should handle models without default_temperature", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/model-no-temp",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model without Default Temperature",
					description: "Model without custom default temperature",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/model-no-temp"].defaultTemperature).toBeUndefined()
	})

	it("should set defaultToolProtocol to native when default-native-tools tag is present", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/native-tools-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Native Tools Model",
					description: "Model with native tool calling default",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["tool-use", "default-native-tools"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/native-tools-model"].supportsNativeTools).toBe(true)
		expect(models["test/native-tools-model"].defaultToolProtocol).toBe("native")
	})

	it("should set defaultToolProtocol to native for all models regardless of tags", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/model-without-tool-tags",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model Without Tool Tags",
					description: "Model without any tool-related tags",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: [], // No tool-related tags
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		// All Roo provider models now default to native tool protocol
		expect(models["test/model-without-tool-tags"].supportsNativeTools).toBe(false)
		expect(models["test/model-without-tool-tags"].defaultToolProtocol).toBe("native")
	})

	it("should set supportsNativeTools from tool-use tag and always set defaultToolProtocol to native", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/tool-use-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Tool Use Model",
					description: "Model with tool-use tag",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["tool-use"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		// tool-use tag sets supportsNativeTools, and all models get defaultToolProtocol: native
		expect(models["test/tool-use-model"].supportsNativeTools).toBe(true)
		expect(models["test/tool-use-model"].defaultToolProtocol).toBe("native")
	})

	it("should detect stealth mode from tags", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/stealth-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Stealth Model",
					description: "Model with stealth mode",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["stealth"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/stealth-model"].isStealthModel).toBe(true)
	})

	it("should not set isStealthModel when stealth tag is absent", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/non-stealth-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Non-Stealth Model",
					description: "Model without stealth mode",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: [],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/non-stealth-model"].isStealthModel).toBeUndefined()
	})

	it("should apply API-provided settings to model info", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/model-with-settings",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model with Settings",
					description: "Model with API-provided settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["tool-use"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					settings: {
						includedTools: ["apply_patch"],
						excludedTools: ["apply_diff", "write_to_file"],
						reasoningEffort: "high",
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		expect(models["test/model-with-settings"].includedTools).toEqual(["apply_patch"])
		expect(models["test/model-with-settings"].excludedTools).toEqual(["apply_diff", "write_to_file"])
		expect(models["test/model-with-settings"].reasoningEffort).toBe("high")
	})

	it("should handle arbitrary settings properties dynamically", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/dynamic-settings-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Dynamic Settings Model",
					description: "Model with arbitrary settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: [],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					settings: {
						customProperty: "custom-value",
						anotherSetting: 42,
						nestedConfig: { key: "value" },
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)
		const model = models["test/dynamic-settings-model"] as any

		// Arbitrary settings should be passed through
		expect(model.customProperty).toBe("custom-value")
		expect(model.anotherSetting).toBe(42)
		expect(model.nestedConfig).toEqual({ key: "value" })
	})

	it("should apply versioned settings when version matches", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/versioned-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model with Versioned Settings",
					description: "Model with versioned settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["tool-use"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					// Plain settings for backward compatibility with old clients
					settings: {
						includedTools: ["apply_patch"],
						excludedTools: ["write_to_file"],
					},
					// Versioned settings keyed by version number (low version - always met)
					versionedSettings: {
						"1.0.0": {
							includedTools: ["apply_patch", "search_replace"],
							excludedTools: ["apply_diff", "write_to_file"],
						},
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		// Versioned settings should be used instead of plain settings
		expect(models["test/versioned-model"].includedTools).toEqual(["apply_patch", "search_replace"])
		expect(models["test/versioned-model"].excludedTools).toEqual(["apply_diff", "write_to_file"])
	})

	it("should use plain settings when no versioned settings version matches", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/old-version-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model for Old Version",
					description: "Model with versioned settings for newer version",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: ["tool-use"],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					settings: {
						includedTools: ["apply_patch"],
					},
					// Versioned settings keyed by very high version - never met
					versionedSettings: {
						"99.0.0": {
							includedTools: ["apply_patch", "search_replace"],
						},
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)

		// Should use plain settings since no versioned settings match current version
		expect(models["test/old-version-model"].includedTools).toEqual(["apply_patch"])
	})

	it("should handle model with only versionedSettings and no plain settings", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/versioned-only-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model with Only Versioned Settings",
					description: "Model with only versioned settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: [],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					// No plain settings, only versionedSettings keyed by version
					versionedSettings: {
						"1.0.0": {
							customFeature: true,
						},
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)
		const model = models["test/versioned-only-model"] as Record<string, unknown>

		expect(model.customFeature).toBe(true)
	})

	it("should select highest matching version from versionedSettings", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/multi-version-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Model with Multiple Versions",
					description: "Model with multiple version settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					tags: [],
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					settings: {
						feature: "default",
					},
					// Multiple version keys - should use highest one <= current version
					versionedSettings: {
						"99.0.0": { feature: "future" },
						"3.0.0": { feature: "current" },
						"2.0.0": { feature: "old" },
						"1.0.0": { feature: "very_old" },
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		const models = await getRooModels(baseUrl, apiKey)
		const model = models["test/multi-version-model"] as Record<string, unknown>

		// Should use 3.0.0 version settings (highest that's <= current plugin version)
		expect(model.feature).toBe("current")
	})

	it("should apply highest versionedSettings for nightly builds (package name)", async () => {
		const mockResponse = {
			object: "list",
			data: [
				{
					id: "test/nightly-version-model",
					object: "model",
					created: 1234567890,
					owned_by: "test",
					name: "Nightly Model",
					description: "Model with multiple versioned settings",
					context_window: 128000,
					max_tokens: 8192,
					type: "language",
					pricing: {
						input: "0.0001",
						output: "0.0002",
					},
					settings: {
						feature: "plain",
					},
					versionedSettings: {
						"3.36.3": { feature: "v3" },
						"2.0.0": { feature: "v2" },
					},
				},
			],
		}

		mockFetch.mockResolvedValueOnce({
			ok: true,
			json: async () => mockResponse,
		})

		// Simulate nightly build via package name
		const originalName = Package.name
		;(Package as { name: string }).name = "roo-code-nightly"

		try {
			const models = await getRooModels(baseUrl, apiKey)
			const model = models["test/nightly-version-model"] as Record<string, unknown>

			// Should pick the highest available versionedSettings even though 3.36.3 > 0.0.7465
			expect(model.feature).toBe("v3")
		} finally {
			;(Package as { name: string }).name = originalName
		}
	})
})
