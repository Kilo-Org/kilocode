// npx vitest run src/api/providers/fetchers/__tests__/poe.spec.ts

vi.mock("axios")

import type { Mock } from "vitest"
import axios from "axios"
import { getPoeModels } from "../poe"
import { POE_BASE_URL } from "@roo-code/types"

const mockedAxios = axios as typeof axios & {
	get: Mock
}

describe("getPoeModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should fetch and parse models successfully", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "gpt-4o",
						object: "model",
						owned_by: "OpenAI",
						description: "GPT-4o model",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 128000,
							max_output_tokens: 16384,
						},
						pricing: {
							prompt: "0.0000025",
							completion: "0.00001",
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-api-key")

		expect(mockedAxios.get).toHaveBeenCalledWith(`${POE_BASE_URL}models`, {
			headers: {
				Authorization: "Bearer test-api-key",
			},
		})

		expect(models["gpt-4o"]).toEqual({
			maxTokens: 16384,
			contextWindow: 128000,
			supportsImages: true,
			supportsPromptCache: false,
			supportsComputerUse: undefined,
			supportsReasoningBudget: false,
			supportsReasoningEffort: false,
			requiredReasoningBudget: undefined,
			inputPrice: 2.5,
			outputPrice: 10,
			description: "GPT-4o model",
			cacheWritesPrice: undefined,
			cacheReadsPrice: undefined,
		})
	})

	it("should work without API key", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 8000,
							max_output_tokens: 4000,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels()

		expect(mockedAxios.get).toHaveBeenCalledWith(`${POE_BASE_URL}models`, {
			headers: {},
		})

		expect(models["test-model"]).toBeDefined()
	})

	it("should detect image support from input_modalities", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "vision-model",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 128000,
							max_output_tokens: 8192,
						},
					},
					{
						id: "text-only-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 64000,
							max_output_tokens: 4096,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["vision-model"].supportsImages).toBe(true)
		expect(models["text-only-model"].supportsImages).toBe(false)
	})

	it("should parse reasoning capabilities", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "claude-opus-4.5",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 200000,
							max_output_tokens: 64000,
						},
						reasoning: {
							budget: {
								max_tokens: 63999,
								min_tokens: 0,
							},
							required: false,
							supports_reasoning_effort: false,
						},
					},
					{
						id: "gpt-5.2-pro",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 400000,
							max_output_tokens: 128000,
						},
						reasoning: {
							supports_reasoning_effort: true,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["claude-opus-4.5"].supportsReasoningBudget).toBe(true)
		expect(models["claude-opus-4.5"].supportsReasoningEffort).toBe(false)
		expect(models["claude-opus-4.5"].requiredReasoningBudget).toBe(undefined)

		expect(models["gpt-5.2-pro"].supportsReasoningBudget).toBe(false)
		expect(models["gpt-5.2-pro"].supportsReasoningEffort).toBe(true)
	})

	it("should handle required reasoning budget", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "reasoning-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 100000,
							max_output_tokens: 32000,
						},
						reasoning: {
							budget: {
								max_tokens: 50000,
								min_tokens: 1000,
							},
							required: true,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["reasoning-model"].requiredReasoningBudget).toBe(true)
	})

	it("should detect prompt cache support from pricing", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "cache-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 200000,
							max_output_tokens: 8192,
						},
						pricing: {
							prompt: "0.000003",
							completion: "0.000015",
							input_cache_read: "0.0000003",
							input_cache_write: "0.00000375",
						},
					},
					{
						id: "no-cache-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 128000,
							max_output_tokens: 4096,
						},
						pricing: {
							prompt: "0.000002",
							completion: "0.00001",
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["cache-model"].supportsPromptCache).toBe(true)
		expect(models["cache-model"].cacheReadsPrice).toBe(0.3)
		expect(models["cache-model"].cacheWritesPrice).toBe(3.75)

		expect(models["no-cache-model"].supportsPromptCache).toBe(false)
	})

	it("should skip models without text output modality", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "image-gen-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["image"], // Not text
						},
						context_window: {
							context_length: 4096,
							max_output_tokens: 1,
						},
					},
					{
						id: "text-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 128000,
							max_output_tokens: 8192,
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["image-gen-model"]).toBeUndefined()
		expect(models["text-model"]).toBeDefined()
	})

	it("should return empty object on API error", async () => {
		mockedAxios.get.mockRejectedValue(new Error("Network error"))

		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const models = await getPoeModels("test-key")

		expect(models).toEqual({})
		expect(consoleErrorSpy).toHaveBeenCalled()

		consoleErrorSpy.mockRestore()
	})

	it("should return empty object when API returns empty data", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models).toEqual({})
	})

	it("should handle missing context_window gracefully", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "minimal-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						// No context_window field
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["minimal-model"]).toBeDefined()
		expect(models["minimal-model"].contextWindow).toBe(0)
		expect(models["minimal-model"].maxTokens).toBe(0)
	})

	it("should parse computer use support", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "computer-use-model",
						architecture: {
							input_modalities: ["text", "image"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 200000,
							max_output_tokens: 8192,
						},
						supports_computer_use: true,
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["computer-use-model"].supportsComputerUse).toBe(true)
	})

	it("should handle alternative cache pricing field names", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "alt-cache-model",
						architecture: {
							input_modalities: ["text"],
							output_modalities: ["text"],
						},
						context_window: {
							context_length: 200000,
							max_output_tokens: 8192,
						},
						pricing: {
							prompt: "0.000003",
							completion: "0.000015",
							cache_read: "0.0000003", // Alternative field name
							cache_creation: "0.00000375", // Alternative field name
						},
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getPoeModels("test-key")

		expect(models["alt-cache-model"].supportsPromptCache).toBe(true)
		expect(models["alt-cache-model"].cacheReadsPrice).toBe(0.3)
		expect(models["alt-cache-model"].cacheWritesPrice).toBe(3.75)
	})
})
