// kilocode_change - new file
// Mocks must come first, before imports
vi.mock("axios")

import type { Mock } from "vitest"
import axios from "axios"
import { getOpenAiModels } from "../openai"

const mockedAxios = axios as typeof axios & {
	get: Mock
	isAxiosError: Mock
}

describe("getOpenAiModels", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	it("returns empty object when no baseUrl is provided", async () => {
		const result = await getOpenAiModels({})

		expect(mockedAxios.get).not.toHaveBeenCalled()
		expect(result).toEqual({})
	})

	it("returns empty object when baseUrl is undefined", async () => {
		const result = await getOpenAiModels({ baseUrl: undefined })

		expect(mockedAxios.get).not.toHaveBeenCalled()
		expect(result).toEqual({})
	})

	it("successfully fetches and formats OpenAI Compatible models", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "gpt-4-turbo",
						object: "model",
						created: 1699000000,
						owned_by: "openai",
					},
					{
						id: "llama-3.1-70b",
						object: "model",
						created: 1699000001,
						owned_by: "meta",
					},
				],
				object: "list",
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1",
			apiKey: "test-api-key",
		})

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:8080/v1/models", {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-api-key",
			},
			timeout: 10_000,
		})

		expect(result).toEqual({
			"gpt-4-turbo": {
				maxTokens: 8192,
				contextWindow: 32000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsComputerUse: false,
				description: "gpt-4-turbo",
				displayName: "gpt-4-turbo",
				supportsReasoningEffort: false,
				supportsReasoningBudget: false,
				supportsTemperature: true,
				supportsNativeTools: true,
				defaultToolProtocol: "native",
			},
			"llama-3.1-70b": {
				maxTokens: 8192,
				contextWindow: 32000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsComputerUse: false,
				description: "llama-3.1-70b",
				displayName: "llama-3.1-70b",
				supportsReasoningEffort: false,
				supportsReasoningBudget: false,
				supportsTemperature: true,
				supportsNativeTools: true,
				defaultToolProtocol: "native",
			},
		})
	})

	it("handles base URLs with trailing slashes correctly", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1/",
			apiKey: "test-api-key",
		})

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:8080/v1/models", {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-api-key",
			},
			timeout: 10_000,
		})
	})

	it("handles base URLs with multiple trailing slashes correctly", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1///",
			apiKey: "test-api-key",
		})

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:8080/v1/models", {
			headers: {
				"Content-Type": "application/json",
				Authorization: "Bearer test-api-key",
			},
			timeout: 10_000,
		})
	})

	it("makes request without authorization header when no API key provided", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1",
		})

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:8080/v1/models", {
			headers: {
				"Content-Type": "application/json",
			},
			timeout: 10_000,
		})
	})

	it("includes custom headers in request", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1",
			apiKey: "test-api-key",
			headers: {
				"X-Custom-Header": "custom-value",
				"X-Another-Header": "another-value",
			},
		})

		expect(mockedAxios.get).toHaveBeenCalledWith("http://localhost:8080/v1/models", {
			headers: {
				"Content-Type": "application/json",
				"X-Custom-Header": "custom-value",
				"X-Another-Header": "another-value",
				Authorization: "Bearer test-api-key",
			},
			timeout: 10_000,
		})
	})

	it("returns empty object when data array is empty", async () => {
		const mockResponse = {
			data: {
				data: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1",
			apiKey: "test-api-key",
		})

		expect(result).toEqual({})
	})

	it("throws error for invalid response format", async () => {
		const mockResponse = {
			data: {
				// Missing 'data' field
				models: [],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		await expect(
			getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			}),
		).rejects.toThrow("OpenAI Compatible API returned invalid response format")
	})

	it("throws error for timeout", async () => {
		const axiosError = {
			code: "ECONNABORTED",
			isAxiosError: true,
		}

		mockedAxios.isAxiosError.mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(axiosError)

		await expect(
			getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			}),
		).rejects.toThrow("Failed to fetch OpenAI Compatible models from http://localhost:8080/v1: Request timeout")
	})

	it("throws detailed error for HTTP error responses", async () => {
		const axiosError = {
			response: {
				status: 401,
				statusText: "Unauthorized",
			},
			isAxiosError: true,
		}

		mockedAxios.isAxiosError.mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(axiosError)

		await expect(
			getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "invalid-key",
			}),
		).rejects.toThrow("Failed to fetch OpenAI Compatible models from http://localhost:8080/v1: 401 Unauthorized")
	})

	it("throws network error for request failures", async () => {
		const axiosError = {
			request: {},
			isAxiosError: true,
		}

		mockedAxios.isAxiosError.mockReturnValue(true)
		mockedAxios.get.mockRejectedValue(axiosError)

		await expect(
			getOpenAiModels({
				baseUrl: "http://invalid-url/v1",
				apiKey: "test-api-key",
			}),
		).rejects.toThrow("Failed to fetch OpenAI Compatible models from http://invalid-url/v1: No response")
	})

	it("throws generic error for other failures", async () => {
		const genericError = new Error("Network timeout")

		mockedAxios.isAxiosError.mockReturnValue(false)
		mockedAxios.get.mockRejectedValue(genericError)

		await expect(
			getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			}),
		).rejects.toThrow("Failed to fetch OpenAI Compatible models from http://localhost:8080/v1: Network timeout")
	})

	it("handles models with minimal fields", async () => {
		const mockResponse = {
			data: {
				data: [
					{
						id: "minimal-model",
						// Only id is required by schema
					},
				],
			},
		}

		mockedAxios.get.mockResolvedValue(mockResponse)

		const result = await getOpenAiModels({
			baseUrl: "http://localhost:8080/v1",
			apiKey: "test-api-key",
		})

		expect(result).toEqual({
			"minimal-model": {
				maxTokens: 8192,
				contextWindow: 32000,
				supportsImages: false,
				supportsPromptCache: false,
				supportsComputerUse: false,
				description: "minimal-model",
				displayName: "minimal-model",
				supportsReasoningEffort: false,
				supportsReasoningBudget: false,
				supportsTemperature: true,
				supportsNativeTools: true,
				defaultToolProtocol: "native",
			},
		})
	})

	// Tests for extended model info parsing (common fields)
	describe("extended model info parsing", () => {
		it("parses context_window for context window", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "extended-model",
							context_window: 128000,
							max_output_tokens: 16384,
							supports_vision: true,
							description: "A powerful vision model",
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["extended-model"]).toMatchObject({
				maxTokens: 16384,
				contextWindow: 128000,
				supportsImages: true,
				description: "A powerful vision model",
			})
		})

		it("parses context_length for context window", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "alt-model",
							context_length: 65536,
							max_tokens: 4096,
							supports_images: true,
							supports_function_calling: true,
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["alt-model"]).toMatchObject({
				maxTokens: 4096,
				contextWindow: 65536,
				supportsImages: true,
				supportsNativeTools: true,
			})
		})

		it("parses pricing info when provided", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "priced-model",
							input_cost_per_token: 0.000003, // $3 per million
							output_cost_per_token: 0.000015, // $15 per million
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["priced-model"]).toMatchObject({
				inputPrice: 3,
				outputPrice: 15,
			})
		})

		it("prioritizes context_window over context_length", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "priority-model",
							context_window: 200000, // Should use this
							context_length: 100000, // Should ignore this
							max_context_length: 50000, // Should ignore this
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["priority-model"].contextWindow).toBe(200000)
		})

		it("prioritizes max_output_tokens over max_tokens", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "tokens-model",
							max_output_tokens: 64000, // Should use this
							max_tokens: 8192, // Should ignore this
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["tokens-model"].maxTokens).toBe(64000)
		})

		it("parses max_completion_tokens for output tokens", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "completion-tokens-model",
							context_window: 131072,
							max_completion_tokens: 65536,
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["completion-tokens-model"].maxTokens).toBe(65536)
			expect(result["completion-tokens-model"].contextWindow).toBe(131072)
		})

		it("defaults supportsNativeTools to true when tool flags not provided", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "no-tool-flags-model",
							// No supports_function_calling or supports_tools
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["no-tool-flags-model"].supportsNativeTools).toBe(true)
		})

		it("respects supports_tools=false when explicitly set", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "no-tools-model",
							supports_tools: false,
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["no-tools-model"].supportsNativeTools).toBe(false)
		})

		it("parses vision flag correctly", async () => {
			const mockResponse = {
				data: {
					data: [
						{
							id: "vision-model",
							vision: true,
						},
					],
				},
			}

			mockedAxios.get.mockResolvedValue(mockResponse)

			const result = await getOpenAiModels({
				baseUrl: "http://localhost:8080/v1",
				apiKey: "test-api-key",
			})

			expect(result["vision-model"].supportsImages).toBe(true)
		})
	})
})
