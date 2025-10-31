// kilocode_change - file added
// npx vitest run api/providers/fetchers/__tests__/chutes.test.ts

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import axios from "axios"
import { getChutesModels } from "../chutes"
import type { ChutesModel } from "../chutes"

// Mock axios
vi.mock("axios")
const mockedAxios = axios as any

describe("getChutesModels", () => {
	let consoleErrorSpy: any

	beforeEach(() => {
		consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
	})

	afterEach(() => {
		vi.restoreAllMocks()
		vi.clearAllMocks()
	})

	it("should successfully fetch and parse models from Chutes.AI API", async () => {
		const mockChutesResponse = {
			object: "list",
			data: [
				{
					id: "deepseek-ai/DeepSeek-R1-0528",
					root: "deepseek-ai/DeepSeek-R1-0528",
					price: {
						input: { tao: 1.0, usd: 0.55 },
						output: { tao: 2.0, usd: 2.19 },
					},
					object: "model",
					created: 1704067200,
					pricing: { prompt: 0.55, completion: 2.19 },
					owned_by: "deepseek",
					quantization: "fp8",
					max_model_len: 163840,
					context_length: 163840,
					input_modalities: ["text"],
					max_output_length: 163840,
					output_modalities: ["text"],
					supported_features: ["json_mode", "structured_outputs", "reasoning"],
					supported_sampling_parameters: [
						"temperature",
						"top_p",
						"top_k",
						"repetition_penalty",
						"frequency_penalty",
						"presence_penalty",
						"stop",
						"seed",
					],
				},
				{
					id: "zai-org/GLM-4.5V",
					root: "zai-org/GLM-4.5V",
					price: {
						input: { tao: 0.5, usd: 0.08 },
						output: { tao: 1.5, usd: 0.33 },
					},
					object: "model",
					created: 1704067200,
					pricing: { prompt: 0.08, completion: 0.33 },
					owned_by: "zai-org",
					quantization: null,
					max_model_len: 131072,
					context_length: 131072,
					input_modalities: ["text", "image"],
					max_output_length: 131072,
					output_modalities: ["text"],
					supported_features: ["json_mode", "structured_outputs", "vision"],
					supported_sampling_parameters: [
						"temperature",
						"top_p",
						"top_k",
						"repetition_penalty",
						"frequency_penalty",
						"presence_penalty",
						"stop",
						"seed",
					],
				},
			],
		}

		mockedAxios.get.mockResolvedValueOnce({ data: mockChutesResponse })

		const result = await getChutesModels("test-api-key")

		expect(mockedAxios.get).toHaveBeenCalledWith("https://llm.chutes.ai/v1/models", {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-api-key",
			},
			timeout: 10000,
		})

		expect(Object.keys(result)).toHaveLength(2)

		// Test DeepSeek R1 model (reasoning model)
		const deepseekModel = result["deepseek-ai/DeepSeek-R1-0528"]
		expect(deepseekModel).toEqual({
			maxTokens: 32768,
			contextWindow: 163840,
			supportsImages: false,
			supportsPromptCache: true,
			supportsComputerUse: false,
			inputPrice: 0.55, // $0.55 per 1M tokens
			outputPrice: 2.19, // $2.19 per 1M tokens
			description: "deepseek-ai/DeepSeek-R1-0528 via Chutes.AI",
			supportsReasoningEffort: false,
			supportsReasoningBudget: true,
			supportedParameters: [],
		})

		// Test GLM vision model
		const glmModel = result["zai-org/GLM-4.5V"]
		expect(glmModel).toEqual({
			maxTokens: 26215, // 20% of 131072 = 26214.4, rounded up
			contextWindow: 131072,
			supportsImages: true,
			supportsPromptCache: true,
			supportsComputerUse: false,
			inputPrice: 0.08, // $0.08 per 1M tokens
			outputPrice: 0.33, // $0.33 per 1M tokens
			description: "zai-org/GLM-4.5V via Chutes.AI",
			supportsReasoningEffort: false,
			supportsReasoningBudget: false,
			supportedParameters: [],
		})
	})

	it("should handle models without USD pricing", async () => {
		const mockChutesResponse = {
			object: "list",
			data: [
				{
					id: "test/free-model",
					root: "test/free-model",
					price: null, // No pricing available
					object: "model",
					created: 1704067200,
					pricing: null,
					owned_by: "test",
					quantization: "fp8",
					max_model_len: 8192,
					context_length: 8192,
					input_modalities: ["text"],
					max_output_length: 8192,
					output_modalities: ["text"],
					supported_features: ["text"],
					supported_sampling_parameters: ["temperature", "top_p", "seed", "stop"],
				},
			],
		}

		mockedAxios.get.mockResolvedValueOnce({ data: mockChutesResponse })

		const result = await getChutesModels()

		const model = result["test/free-model"]
		expect(model).toEqual({
			maxTokens: 1639, // 20% of 8192, rounded up
			contextWindow: 8192,
			supportsImages: false,
			supportsPromptCache: true,
			supportsComputerUse: false,
			inputPrice: 0, // Default pricing when none available
			outputPrice: 0,
			description: "test/free-model via Chutes.AI",
			supportsReasoningEffort: false,
			supportsReasoningBudget: false,
			supportedParameters: [],
		})
	})

	it("should work without API key", async () => {
		const mockChutesResponse = {
			object: "list",
			data: [], // Empty model list
		}

		mockedAxios.get.mockResolvedValueOnce({ data: mockChutesResponse })

		const result = await getChutesModels()

		expect(mockedAxios.get).toHaveBeenCalledWith("https://llm.chutes.ai/v1/models", {
			headers: {
				"Content-Type": "application/json",
			},
			timeout: 10000,
		})

		expect(result).toEqual({})
	})

	it("should handle axios network error", async () => {
		const networkError = new Error("Network error")
		mockedAxios.get.mockRejectedValueOnce(networkError)

		await expect(getChutesModels()).rejects.toThrow("Failed to fetch Chutes.AI models: Network error")
	})

	it("should handle axios timeout error", async () => {
		const timeoutError = new Error("Request timeout") as any
		timeoutError.isAxiosError = true // Make it look like an axios error
		timeoutError.code = "ECONNABORTED"
		mockedAxios.get.mockRejectedValueOnce(timeoutError)

		await expect(getChutesModels()).rejects.toThrow("Failed to fetch Chutes.AI models: Request timeout")
	})

	it("should handle axios response error", async () => {
		const responseError = new Error("Request failed")
		mockedAxios.get.mockRejectedValueOnce(responseError)

		// Should propagate the network error through our generic error handling
		await expect(getChutesModels()).rejects.toThrow("Failed to fetch Chutes.AI models: Request failed")
	})

	it("should handle axios no response error", async () => {
		const noResponseError = new Error("No response") as any
		noResponseError.isAxiosError = true // Make it look like an axios error
		noResponseError.request = {}
		mockedAxios.get.mockRejectedValueOnce(noResponseError)

		await expect(getChutesModels()).rejects.toThrow("Failed to fetch Chutes.AI models: No response")
	})

	it("should throw error for invalid response schema", async () => {
		const invalidResponse = {
			object: "invalid", // Wrong object type
			data: "not an array", // Invalid data type
		}

		mockedAxios.get.mockResolvedValueOnce({ data: invalidResponse })

		// Schema validation should fail and throw an error with details
		await expect(getChutesModels()).rejects.toThrow(
			"Chutes.AI API returned invalid response format. This indicates an API contract change.",
		)

		// Error should be logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Chutes.AI models response validation failed:", expect.any(Object))
	})

	it("should handle models with minimal fields", async () => {
		const minimalResponse = {
			object: "list",
			data: [
				{
					// Only required field is id, all others are optional
					id: "test/model",
				},
			],
		}

		mockedAxios.get.mockResolvedValueOnce({ data: minimalResponse })

		// With flexible schema, should successfully parse models with minimal fields
		const result = await getChutesModels()
		expect(result).toHaveProperty("test/model")
		expect(result["test/model"]).toHaveProperty("contextWindow", 8192) // Default fallback
		expect(result["test/model"]).toHaveProperty("description", "test/model via Chutes.AI")
		expect(result["test/model"]).toHaveProperty("maxTokens", 1639) // 20% of 8192
		expect(result["test/model"]).toHaveProperty("inputPrice", 0) // Default when no pricing
		expect(result["test/model"]).toHaveProperty("outputPrice", 0)

		// Should not log validation errors with the flexible schema
		expect(consoleErrorSpy).not.toHaveBeenCalled()
	})

	it("should cap maxTokens correctly for large context windows", async () => {
		const mockChutesResponse = {
			object: "list",
			data: [
				{
					id: "test/large-context",
					object: "model",
					created: 1704067200,
					owned_by: "test",
					root: "test/large-context",
					parent: null,
					pricing: null,
					quantization: "fp8",
					max_model_len: 512000,
					context_length: 512000,
					input_modalities: ["text"],
					output_modalities: ["text"],
					supported_features: {
						text: true,
						vision: false,
						audio: false,
						function_calling: false,
						json_mode: false,
						json_object: false,
						seed: true,
						temperature: true,
						top_p: true,
						top_k: false,
						repetition_penalty: false,
						frequency_penalty: false,
						presence_penalty: false,
						stop: true,
						max_tokens: true,
						logit_bias: false,
					},
					sampling_params: {
						temperature: { min: 0.0, max: 2.0, default: 0.7 },
						top_p: { min: 0.0, max: 1.0, default: 0.95 },
						top_k: { min: 1, max: 100, default: 40 },
						repetition_penalty: { min: 1.0, max: 2.0, default: 1.05 },
						frequency_penalty: { min: -2.0, max: 2.0, default: 0.0 },
						presence_penalty: { min: -2.0, max: 2.0, default: 0.0 },
					},
				},
			],
		}

		mockedAxios.get.mockResolvedValueOnce({ data: mockChutesResponse })

		const result = await getChutesModels()

		const model = result["test/large-context"]
		expect(model.maxTokens).toBe(32768) // Capped at 32k
		expect(model.contextWindow).toBe(512000)
	})

	it("should handle zero pricing values correctly", async () => {
		const mockChutesResponse = {
			object: "list",
			data: [
				{
					id: "test/zero-price",
					object: "model",
					created: 1704067200,
					owned_by: "test",
					root: "test/zero-price",
					parent: null,
					pricing: {
						tao: { input: 0, output: 0 },
						usd: { input: 0, output: 0 },
					},
					quantization: "fp8",
					max_model_len: 4096,
					context_length: 4096,
					input_modalities: ["text"],
					output_modalities: ["text"],
					supported_features: {
						text: true,
						vision: false,
						audio: false,
						function_calling: false,
						json_mode: false,
						json_object: false,
						seed: true,
						temperature: true,
						top_p: true,
						top_k: false,
						repetition_penalty: false,
						frequency_penalty: false,
						presence_penalty: false,
						stop: true,
						max_tokens: true,
						logit_bias: false,
					},
					sampling_params: {
						temperature: { min: 0.0, max: 2.0, default: 0.7 },
						top_p: { min: 0.0, max: 1.0, default: 0.95 },
						top_k: { min: 1, max: 100, default: 40 },
						repetition_penalty: { min: 1.0, max: 2.0, default: 1.05 },
						frequency_penalty: { min: -2.0, max: 2.0, default: 0.0 },
						presence_penalty: { min: -2.0, max: 2.0, default: 0.0 },
					},
				},
			],
		}

		mockedAxios.get.mockResolvedValueOnce({ data: mockChutesResponse })

		const result = await getChutesModels()

		const model = result["test/zero-price"]
		expect(model.inputPrice).toBe(0)
		expect(model.outputPrice).toBe(0)
	})
})
