import type { MockedClass, MockedFunction } from "vitest"
import { describe, it, expect, beforeEach, vi } from "vitest"
import { OpenAI } from "openai"
import { OpenRouterEmbedder, OPENROUTER_DEFAULT_PROVIDER_NAME } from "../openrouter"
import { getModelDimension, getDefaultModelId } from "../../../../shared/embeddingModels"
import { DEFAULT_HEADERS } from "../../../../api/providers/constants" // kilocode_change

// Mock the OpenAI SDK
vi.mock("openai")

// Mock TelemetryService
vi.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vi.fn(),
		},
	},
	TelemetryEventName: {},
}))

// Mock i18n
vi.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"embeddings:validation.apiKeyRequired": "validation.apiKeyRequired",
			"embeddings:authenticationFailed":
				"Failed to create embeddings: Authentication failed. Please check your OpenRouter API key.",
			"embeddings:failedWithStatus": `Failed to create embeddings after ${params?.attempts} attempts: HTTP ${params?.statusCode} - ${params?.errorMessage}`,
			"embeddings:failedWithError": `Failed to create embeddings after ${params?.attempts} attempts: ${params?.errorMessage}`,
			"embeddings:failedMaxAttempts": `Failed to create embeddings after ${params?.attempts} attempts`,
			"embeddings:textExceedsTokenLimit": `Text at index ${params?.index} exceeds maximum token limit (${params?.itemTokens} > ${params?.maxTokens}). Skipping.`,
			"embeddings:rateLimitRetry": `Rate limit hit, retrying in ${params?.delayMs}ms (attempt ${params?.attempt}/${params?.maxRetries})`,
		}
		return translations[key] || key
	},
}))

const MockedOpenAI = OpenAI as MockedClass<typeof OpenAI>

describe("OpenRouterEmbedder", () => {
	const mockApiKey = "test-api-key"
	let mockEmbeddingsCreate: MockedFunction<any>
	let mockOpenAIInstance: any

	beforeEach(() => {
		vi.clearAllMocks()
		vi.spyOn(console, "warn").mockImplementation(() => {})
		vi.spyOn(console, "error").mockImplementation(() => {})

		// Setup mock OpenAI instance
		mockEmbeddingsCreate = vi.fn()
		mockOpenAIInstance = {
			embeddings: {
				create: mockEmbeddingsCreate,
			},
		}

		MockedOpenAI.mockImplementation(() => mockOpenAIInstance)
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	describe("constructor", () => {
		it("should create an instance with valid API key", () => {
			const embedder = new OpenRouterEmbedder(mockApiKey)
			expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
		})

		it("should throw error with empty API key", () => {
			expect(() => new OpenRouterEmbedder("")).toThrow("validation.apiKeyRequired")
		})

		it("should use default model when none specified", () => {
			const embedder = new OpenRouterEmbedder(mockApiKey)
			const expectedDefault = getDefaultModelId("openrouter")
			expect(embedder.embedderInfo.name).toBe("openrouter")
		})

		it("should use custom model when specified", () => {
			const customModel = "openai/text-embedding-3-small"
			const embedder = new OpenRouterEmbedder(mockApiKey, customModel)
			expect(embedder.embedderInfo.name).toBe("openrouter")
		})

		it("should initialize OpenAI client with correct headers", () => {
			new OpenRouterEmbedder(mockApiKey)

			expect(MockedOpenAI).toHaveBeenCalledWith({
				baseURL: "https://openrouter.ai/api/v1",
				apiKey: mockApiKey,
				defaultHeaders: DEFAULT_HEADERS, // kilocode_change
			})
		})

		it("should accept specificProvider parameter", () => {
			const embedder = new OpenRouterEmbedder(mockApiKey, undefined, undefined, "together")
			expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
		})

		it("should ignore default provider name as specificProvider", () => {
			const embedder = new OpenRouterEmbedder(mockApiKey, undefined, undefined, OPENROUTER_DEFAULT_PROVIDER_NAME)
			expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
		})
	})

	describe("embedderInfo", () => {
		it("should return correct embedder info", () => {
			const embedder = new OpenRouterEmbedder(mockApiKey)
			expect(embedder.embedderInfo).toEqual({
				name: "openrouter",
			})
		})
	})

	describe("createEmbeddings", () => {
		let embedder: OpenRouterEmbedder

		beforeEach(() => {
			embedder = new OpenRouterEmbedder(mockApiKey)
		})

		it("should create embeddings successfully", async () => {
			// Create base64 encoded embedding with values that can be exactly represented in Float32
			const testEmbedding = new Float32Array([0.25, 0.5, 0.75])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 5,
					total_tokens: 5,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(["test text"])

			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test text"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
			})
			expect(result.embeddings).toHaveLength(1)
			expect(result.embeddings[0]).toEqual([0.25, 0.5, 0.75])
			expect(result.usage?.promptTokens).toBe(5)
			expect(result.usage?.totalTokens).toBe(5)
		})

		it("should handle multiple texts", async () => {
			const embedding1 = new Float32Array([0.25, 0.5])
			const embedding2 = new Float32Array([0.75, 1.0])
			const base64String1 = Buffer.from(embedding1.buffer).toString("base64")
			const base64String2 = Buffer.from(embedding2.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String1,
					},
					{
						embedding: base64String2,
					},
				],
				usage: {
					prompt_tokens: 10,
					total_tokens: 10,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(["text1", "text2"])

			expect(result.embeddings).toHaveLength(2)
			expect(result.embeddings[0]).toEqual([0.25, 0.5])
			expect(result.embeddings[1]).toEqual([0.75, 1.0])
		})

		it("should use custom model when provided", async () => {
			const customModel = "mistralai/mistral-embed-2312"
			const embedderWithCustomModel = new OpenRouterEmbedder(mockApiKey, customModel)

			const testEmbedding = new Float32Array([0.25, 0.5])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 5,
					total_tokens: 5,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			await embedderWithCustomModel.createEmbeddings(["test"])

			// Verify the embeddings.create was called with the custom model
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test"],
				model: customModel,
				encoding_format: "base64",
			})
		})

		it("should include provider routing when specificProvider is set", async () => {
			const specificProvider = "together"
			const embedderWithProvider = new OpenRouterEmbedder(mockApiKey, undefined, undefined, specificProvider)

			const testEmbedding = new Float32Array([0.25, 0.5])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 5,
					total_tokens: 5,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			await embedderWithProvider.createEmbeddings(["test"])

			// Verify the embeddings.create was called with provider routing
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
				provider: {
					order: [specificProvider],
					only: [specificProvider],
					allow_fallbacks: false,
				},
			})
		})

		it("should not include provider routing when specificProvider is default", async () => {
			const embedderWithDefaultProvider = new OpenRouterEmbedder(
				mockApiKey,
				undefined,
				undefined,
				OPENROUTER_DEFAULT_PROVIDER_NAME,
			)

			const testEmbedding = new Float32Array([0.25, 0.5])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 5,
					total_tokens: 5,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			await embedderWithDefaultProvider.createEmbeddings(["test"])

			// Verify the embeddings.create was called without provider routing
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
			})
		})
	})

	describe("validateConfiguration", () => {
		let embedder: OpenRouterEmbedder

		beforeEach(() => {
			embedder = new OpenRouterEmbedder(mockApiKey)
		})

		it("should validate configuration successfully", async () => {
			const testEmbedding = new Float32Array([0.25, 0.5])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 1,
					total_tokens: 1,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
			})
		})

		it("should handle validation failure", async () => {
			const authError = new Error("Invalid API key")
			;(authError as any).status = 401

			mockEmbeddingsCreate.mockRejectedValue(authError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("embeddings:validation.authenticationFailed")
		})

		it("should validate configuration with specificProvider", async () => {
			const specificProvider = "openai"
			const embedderWithProvider = new OpenRouterEmbedder(mockApiKey, undefined, undefined, specificProvider)

			const testEmbedding = new Float32Array([0.25, 0.5])
			const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

			const mockResponse = {
				data: [
					{
						embedding: base64String,
					},
				],
				usage: {
					prompt_tokens: 1,
					total_tokens: 1,
				},
			}

			mockEmbeddingsCreate.mockResolvedValue(mockResponse)

			const result = await embedderWithProvider.validateConfiguration()

			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
			expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
				input: ["test"],
				model: "openai/text-embedding-3-large",
				encoding_format: "base64",
				provider: {
					order: [specificProvider],
					only: [specificProvider],
					allow_fallbacks: false,
				},
			})
		})
	})

	describe("integration with shared models", () => {
		it("should work with defined OpenRouter models", () => {
			const openRouterModels = [
				"openai/text-embedding-3-small",
				"openai/text-embedding-3-large",
				"openai/text-embedding-ada-002",
				"google/gemini-embedding-001",
				"mistralai/mistral-embed-2312",
				"mistralai/codestral-embed-2505",
				"qwen/qwen3-embedding-0.6b",
				"qwen/qwen3-embedding-4b",
				"qwen/qwen3-embedding-8b",
			]

			openRouterModels.forEach((model) => {
				const dimension = getModelDimension("openrouter", model)
				expect(dimension).toBeDefined()
				expect(dimension).toBeGreaterThan(0)

				const embedder = new OpenRouterEmbedder(mockApiKey, model)
				expect(embedder.embedderInfo.name).toBe("openrouter")
			})
		})

		it("should use correct default model", () => {
			const defaultModel = getDefaultModelId("openrouter")
			expect(defaultModel).toBe("openai/text-embedding-3-large")

			const dimension = getModelDimension("openrouter", defaultModel)
			expect(dimension).toBe(3072)
		})
	})
})
