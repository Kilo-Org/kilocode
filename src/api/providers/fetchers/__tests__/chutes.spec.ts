// Mocks must come first, before imports
vi.mock("axios")

import type { Mock } from "vitest"
import type { ModelInfo } from "@roo-code/types"
import axios from "axios"
import { getChutesModels } from "../chutes"
import { chutesModels } from "@roo-code/types"

const mockedAxios = axios as typeof axios & {
	get: Mock
}

describe("getChutesModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("should fetch and parse models successfully", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/new-model",
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 128000,
						max_model_len: 8192,
						input_modalities: ["text"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://llm.chutes.ai/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		)

		expect(models["test/new-model"]).toEqual({
			maxTokens: 8192,
			contextWindow: 128000,
			supportsImages: false,
			supportsPromptCache: false,
			supportsNativeTools: false,
			inputPrice: 0,
			outputPrice: 0,
			description: "Chutes AI model: test/new-model",
		})
	})

	it("should override hardcoded models with dynamic API data", async () => {
		// Find any hardcoded model
		const [modelId] = Object.entries(chutesModels)[0]

		const mockResponse = {
			data: {
				data: [
					{
						id: modelId,
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 200000, // Different from hardcoded
						max_model_len: 10000, // Different from hardcoded
						input_modalities: ["text", "image"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Dynamic values should override hardcoded
		expect(models[modelId]).toBeDefined()
		expect(models[modelId].contextWindow).toBe(200000)
		expect(models[modelId].maxTokens).toBe(10000)
		expect(models[modelId].supportsImages).toBe(true)
	})

	it("should return hardcoded models when API returns empty", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Should still have hardcoded models
		expect(Object.keys(models).length).toBeGreaterThan(0)
		expect(models).toEqual(expect.objectContaining(chutesModels))
	})

	it("should return hardcoded models on API error", async () => {
		mockedAxios.get.mockRejectedValue(new Error("Network error"))

		const models = await getChutesModels("test-api-key")

		// Should still have hardcoded models
		expect(Object.keys(models).length).toBeGreaterThan(0)
		expect(models).toEqual(chutesModels)
	})

	it("should work without API key", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels()

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://llm.chutes.ai/v1/models",
			expect.objectContaining({
				headers: expect.not.objectContaining({
					Authorization: expect.anything(),
				}),
			}),
		)

		expect(Object.keys(models).length).toBeGreaterThan(0)
	})

	it("should detect image support from input_modalities", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/image-model",
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 128000,
						max_model_len: 8192,
						input_modalities: ["text", "image"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		expect(models["test/image-model"].supportsImages).toBe(true)
	})

	it("should detect native tool support from supported_features", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/tools-model",
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 128000,
						max_model_len: 8192,
						input_modalities: ["text"],
						supported_features: ["json_mode", "tools", "reasoning"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		expect(models["test/tools-model"].supportsNativeTools).toBe(true)
	})

	it("should not enable native tool support when tools is not in supported_features", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/no-tools-model",
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 128000,
						max_model_len: 8192,
						input_modalities: ["text"],
						supported_features: ["json_mode", "reasoning"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		expect(models["test/no-tools-model"].supportsNativeTools).toBe(false)
		expect(models["test/no-tools-model"].defaultToolProtocol).toBeUndefined()
	})

	it("should skip empty objects in API response and still process valid models", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/valid-model",
						object: "model",
						owned_by: "test",
						created: 1234567890,
						context_length: 128000,
						max_model_len: 8192,
						input_modalities: ["text"],
					},
					{}, // Empty object - should be skipped
					{
						id: "test/another-valid-model",
						object: "model",
						context_length: 64000,
						max_model_len: 4096,
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Valid models should be processed
		expect(models["test/valid-model"]).toBeDefined()
		expect(models["test/valid-model"].contextWindow).toBe(128000)
		expect(models["test/another-valid-model"]).toBeDefined()
		expect(models["test/another-valid-model"].contextWindow).toBe(64000)
	})

	it("should skip models without id field", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						// Missing id field
						object: "model",
						context_length: 128000,
						max_model_len: 8192,
					},
					{
						id: "test/valid-model",
						context_length: 64000,
						max_model_len: 4096,
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Only the valid model should be added
		expect(models["test/valid-model"]).toBeDefined()
		// Hardcoded models should still exist
		expect(Object.keys(models).length).toBeGreaterThan(1)
	})

	it("should calculate maxTokens fallback when max_model_len is missing", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "test/no-max-len-model",
						object: "model",
						context_length: 100000,
						// max_model_len is missing
						input_modalities: ["text"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Should calculate maxTokens as 20% of contextWindow
		expect(models["test/no-max-len-model"]).toBeDefined()
		expect(models["test/no-max-len-model"].maxTokens).toBe(20000) // 100000 * 0.2
		expect(models["test/no-max-len-model"].contextWindow).toBe(100000)
	})

	it("should gracefully handle response with mixed valid and invalid items", async () => {
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		const mockResponse = {
			data: {
				data: [
					{
						id: "test/valid-1",
						context_length: 128000,
						max_model_len: 8192,
					},
					{}, // Empty - will be skipped
					null, // Null - will be skipped
					{
						id: "", // Empty string id - will be skipped
						context_length: 64000,
					},
					{
						id: "test/valid-2",
						context_length: 256000,
						max_model_len: 16384,
						supported_features: ["tools"],
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const models = await getChutesModels("test-api-key")

		// Both valid models should be processed
		expect(models["test/valid-1"]).toBeDefined()
		expect(models["test/valid-2"]).toBeDefined()
		expect(models["test/valid-2"].supportsNativeTools).toBe(true)

		consoleErrorSpy.mockRestore()
	})
})
