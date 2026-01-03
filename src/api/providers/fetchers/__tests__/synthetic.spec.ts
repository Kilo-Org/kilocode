// kilocode_change: file added
// npx vitest run api/providers/fetchers/__tests__/synthetic.spec.ts

// Mocks must come first, before imports
vi.mock("axios")

import type { Mock } from "vitest"
import axios from "axios"
import { getSyntheticModels } from "../synthetic"

const mockedAxios = axios as typeof axios & {
	get: Mock
	isAxiosError: Mock
}

describe("getSyntheticModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	const mockModelsResponse = {
		data: {
			data: [
				{
					id: "test-model-1",
					name: "Test Model 1",
					context_length: 128000,
					max_output_length: 8192,
					pricing: {
						prompt: "$0.00000055",
						completion: "$0.00000219",
					},
					input_modalities: ["text"],
					output_modalities: ["text"],
					supported_sampling_parameters: ["temperature", "top_p"],
					supported_features: [],
				},
				{
					id: "test-model-2",
					name: "Test Model 2",
					context_length: 64000,
					max_output_length: 4096,
					pricing: {
						prompt: "$0.0000001",
						completion: "$0.0000002",
					},
					input_modalities: ["text", "image"],
					output_modalities: ["text"],
					supported_sampling_parameters: ["temperature"],
					supported_features: ["reasoning"],
				},
			],
		},
	}

	it("should fetch models from default base URL when no baseUrl provided", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		await getSyntheticModels("test-api-key")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://api.synthetic.new/openai/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		)
	})

	it("should fetch models from custom base URL when provided", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		await getSyntheticModels("test-api-key", "https://custom.synthetic.example.com/v1")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://custom.synthetic.example.com/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		)
	})

	it("should handle base URL with trailing slash", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		await getSyntheticModels("test-api-key", "https://custom.synthetic.example.com/v1/")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://custom.synthetic.example.com/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		)
	})

	it("should use default base URL when baseUrl is empty string", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		await getSyntheticModels("test-api-key", "")

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://api.synthetic.new/openai/v1/models",
			expect.objectContaining({
				headers: expect.objectContaining({
					Authorization: "Bearer test-api-key",
				}),
			}),
		)
	})

	it("should parse models correctly", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		const models = await getSyntheticModels("test-api-key")

		expect(models["test-model-1"]).toEqual(
			expect.objectContaining({
				contextWindow: 128000,
				maxTokens: 8192,
				supportsImages: false,
				supportsTemperature: true,
			}),
		)

		expect(models["test-model-2"]).toEqual(
			expect.objectContaining({
				contextWindow: 64000,
				maxTokens: 4096,
				supportsImages: true,
				supportsReasoningBudget: true,
				supportsTemperature: true,
			}),
		)
	})

	it("should not include Authorization header when no API key provided", async () => {
		mockedAxios.get.mockResolvedValue(mockModelsResponse)

		await getSyntheticModels()

		expect(mockedAxios.get).toHaveBeenCalledWith(
			"https://api.synthetic.new/openai/v1/models",
			expect.objectContaining({
				headers: {
					"Content-Type": "application/json",
				},
			}),
		)
	})

	it("should throw error on timeout", async () => {
		const timeoutError = new Error("timeout")
		;(timeoutError as any).code = "ECONNABORTED"
		;(axios.isAxiosError as unknown as Mock) = vi.fn().mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(timeoutError)

		await expect(getSyntheticModels("test-api-key")).rejects.toThrow(
			"Failed to fetch Synthetic models: Request timeout",
		)
	})

	it("should throw error on HTTP error response", async () => {
		const httpError = new Error("HTTP Error")
		;(httpError as any).response = { status: 401, statusText: "Unauthorized" }
		;(axios.isAxiosError as unknown as Mock) = vi.fn().mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(httpError)

		await expect(getSyntheticModels("test-api-key")).rejects.toThrow(
			"Failed to fetch Synthetic models: 401 Unauthorized",
		)
	})

	it("should throw error on invalid response format", async () => {
		mockedAxios.get.mockResolvedValue({ data: { invalid: "response" } })

		await expect(getSyntheticModels("test-api-key")).rejects.toThrow(
			"Synthetic API returned invalid response format",
		)
	})
})
