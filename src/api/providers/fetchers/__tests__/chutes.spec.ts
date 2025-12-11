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
})
