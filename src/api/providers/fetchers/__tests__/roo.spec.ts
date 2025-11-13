import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { getRooModels } from "../roo"

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
				supportsPromptCache: true,
				inputPrice: 100, // 0.0001 * 1_000_000
				outputPrice: 200, // 0.0002 * 1_000_000
				cacheWritesPrice: 100, // 0.0001 * 1_000_000
				cacheReadsPrice: 50, // 0.00005 * 1_000_000
				description: "Fast coding model",
				deprecated: false,
				isFree: false,
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
			supportsPromptCache: false,
			inputPrice: 100, // 0.0001 * 1_000_000
			outputPrice: 200, // 0.0002 * 1_000_000
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
			description: "Model that requires reasoning",
			deprecated: false,
			isFree: false,
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
			supportsPromptCache: false,
			inputPrice: 100, // 0.0001 * 1_000_000
			outputPrice: 200, // 0.0002 * 1_000_000
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
			description: "Normal model without reasoning",
			deprecated: false,
			isFree: false,
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
})
