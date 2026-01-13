import type { MockedFunction } from "vitest"
import { BedrockRuntimeClient, InvokeModelCommand } from "@aws-sdk/client-bedrock-runtime"

import { BedrockEmbedder } from "../bedrock"
import { MAX_ITEM_TOKENS, INITIAL_RETRY_DELAY_MS } from "../../constants"

// Mock the AWS SDK
vitest.mock("@aws-sdk/client-bedrock-runtime", () => {
	return {
		BedrockRuntimeClient: vitest.fn().mockImplementation(() => ({
			send: vitest.fn(),
		})),
		InvokeModelCommand: vitest.fn().mockImplementation((input) => ({
			input,
		})),
	}
})
vitest.mock("@aws-sdk/credential-providers", () => ({
	fromEnv: vitest.fn().mockReturnValue(Promise.resolve({})),
	fromIni: vitest.fn().mockReturnValue(Promise.resolve({})),
}))

// Mock TelemetryService
vitest.mock("@roo-code/telemetry", () => ({
	TelemetryService: {
		instance: {
			captureEvent: vitest.fn(),
		},
	},
}))

// Mock i18n
vitest.mock("../../../../i18n", () => ({
	t: (key: string, params?: Record<string, any>) => {
		const translations: Record<string, string> = {
			"embeddings:authenticationFailed":
				"Failed to create embeddings: Authentication failed. Please check your AWS credentials.",
			"embeddings:failedWithStatus": `Failed to create embeddings after ${params?.attempts} attempts: HTTP ${params?.statusCode} - ${params?.errorMessage}`,
			"embeddings:failedWithError": `Failed to create embeddings after ${params?.attempts} attempts: ${params?.errorMessage}`,
			"embeddings:failedMaxAttempts": `Failed to create embeddings after ${params?.attempts} attempts`,
			"embeddings:textExceedsTokenLimit": `Text at index ${params?.index} exceeds maximum token limit (${params?.itemTokens} > ${params?.maxTokens}). Skipping.`,
			"embeddings:rateLimitRetry": `Rate limit hit, retrying in ${params?.delayMs}ms (attempt ${params?.attempt}/${params?.maxRetries})`,
			"embeddings:bedrock.invalidResponseFormat": "Invalid response format from Bedrock",
			"embeddings:bedrock.invalidCredentials": "Invalid AWS credentials",
			"embeddings:bedrock.accessDenied": "Access denied to Bedrock service",
			"embeddings:bedrock.modelNotFound": `Model ${params?.model} not found`,
			"embeddings:validation.authenticationFailed": "Authentication failed",
			"embeddings:validation.connectionFailed": "Connection failed",
			"embeddings:validation.serviceUnavailable": "Service unavailable",
			"embeddings:validation.configurationError": "Configuration error",
		}
		return translations[key] || key
	},
}))

// Mock console methods
const consoleMocks = {
	error: vitest.spyOn(console, "error").mockImplementation(() => {}),
	warn: vitest.spyOn(console, "warn").mockImplementation(() => {}),
}

describe("BedrockEmbedder", () => {
	let embedder: BedrockEmbedder
	let mockSend: MockedFunction<any>

	beforeEach(() => {
		vitest.clearAllMocks()
		consoleMocks.error.mockClear()
		consoleMocks.warn.mockClear()

		mockSend = vitest.fn()

		// Set up the mock implementation
		const MockedBedrockRuntimeClient = BedrockRuntimeClient as any
		MockedBedrockRuntimeClient.mockImplementation(() => ({
			send: mockSend,
		}))

		embedder = new BedrockEmbedder("us-east-1", "test-profile", "amazon.titan-embed-text-v2:0")
	})

	afterEach(() => {
		vitest.clearAllMocks()
	})

	describe("constructor", () => {
		it("should initialize with provided region, profile and model", () => {
			expect(embedder.embedderInfo.name).toBe("bedrock")
		})

		it("should require region", () => {
			expect(() => new BedrockEmbedder("", "profile", "model")).toThrow(
				"Region is required for AWS Bedrock embedder",
			)
		})

		it("should use profile for credentials", () => {
			const profileEmbedder = new BedrockEmbedder("us-west-2", "dev-profile")
			expect(profileEmbedder).toBeDefined()
		})
	})

	describe("createEmbeddings", () => {
		const testModelId = "amazon.titan-embed-text-v2:0"

		it("should create embeddings for a single text with Titan model", async () => {
			const testTexts = ["Hello world"]
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embedding: [0.1, 0.2, 0.3],
						inputTextTokenCount: 2,
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(testTexts)

			expect(mockSend).toHaveBeenCalled()
			const command = mockSend.mock.calls[0][0] as any
			expect(command.input.modelId).toBe(testModelId)
			const bodyStr =
				typeof command.input.body === "string"
					? command.input.body
					: new TextDecoder().decode(command.input.body as Uint8Array)
			expect(JSON.parse(bodyStr || "{}")).toEqual({
				inputText: "Hello world",
			})

			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 2, totalTokens: 2 },
			})
		})

		it("should create embeddings for multiple texts", async () => {
			const testTexts = ["Hello world", "Another text"]
			const mockResponses = [
				{
					body: new TextEncoder().encode(
						JSON.stringify({
							embedding: [0.1, 0.2, 0.3],
							inputTextTokenCount: 2,
						}),
					),
				},
				{
					body: new TextEncoder().encode(
						JSON.stringify({
							embedding: [0.4, 0.5, 0.6],
							inputTextTokenCount: 3,
						}),
					),
				},
			]

			mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

			const result = await embedder.createEmbeddings(testTexts)

			expect(mockSend).toHaveBeenCalledTimes(2)
			expect(result).toEqual({
				embeddings: [
					[0.1, 0.2, 0.3],
					[0.4, 0.5, 0.6],
				],
				usage: { promptTokens: 5, totalTokens: 5 },
			})
		})

		it("should handle Cohere model format", async () => {
			const cohereEmbedder = new BedrockEmbedder("us-east-1", "test-profile", "cohere.embed-english-v3")
			const testTexts = ["Hello world"]
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embeddings: [[0.1, 0.2, 0.3]],
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await cohereEmbedder.createEmbeddings(testTexts)

			const command = mockSend.mock.calls[0][0] as InvokeModelCommand
			const bodyStr =
				typeof command.input.body === "string"
					? command.input.body
					: new TextDecoder().decode(command.input.body as Uint8Array)
			expect(JSON.parse(bodyStr || "{}")).toEqual({
				texts: ["Hello world"],
				input_type: "search_document",
			})

			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 0, totalTokens: 0 },
			})
		})

		it("should create embeddings with Nova multimodal model", async () => {
			const novaMultimodalEmbedder = new BedrockEmbedder(
				"us-east-1",
				"test-profile",
				"amazon.nova-2-multimodal-embeddings-v1:0",
			)
			const testTexts = ["Hello world"]
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embeddings: [
							{
								embedding: [0.1, 0.2, 0.3],
							},
						],
						inputTextTokenCount: 2,
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await novaMultimodalEmbedder.createEmbeddings(testTexts)

			expect(mockSend).toHaveBeenCalled()
			const command = mockSend.mock.calls[0][0] as any
			expect(command.input.modelId).toBe("amazon.nova-2-multimodal-embeddings-v1:0")
			const bodyStr =
				typeof command.input.body === "string"
					? command.input.body
					: new TextDecoder().decode(command.input.body as Uint8Array)
			// Nova multimodal embeddings use a task-based format with nested text object
			expect(JSON.parse(bodyStr || "{}")).toEqual({
				taskType: "SINGLE_EMBEDDING",
				singleEmbeddingParams: {
					embeddingPurpose: "GENERIC_INDEX",
					embeddingDimension: 1024,
					text: {
						truncationMode: "END",
						value: "Hello world",
					},
				},
			})

			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 2, totalTokens: 2 },
			})
		})

		it("should handle Nova multimodal model with multiple texts", async () => {
			const novaMultimodalEmbedder = new BedrockEmbedder(
				"us-east-1",
				"test-profile",
				"amazon.nova-2-multimodal-embeddings-v1:0",
			)
			const testTexts = ["Hello world", "Another text"]
			const mockResponses = [
				{
					body: new TextEncoder().encode(
						JSON.stringify({
							embeddings: [
								{
									embedding: [0.1, 0.2, 0.3],
								},
							],
							inputTextTokenCount: 2,
						}),
					),
				},
				{
					body: new TextEncoder().encode(
						JSON.stringify({
							embeddings: [
								{
									embedding: [0.4, 0.5, 0.6],
								},
							],
							inputTextTokenCount: 3,
						}),
					),
				},
			]

			mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

			const result = await novaMultimodalEmbedder.createEmbeddings(testTexts)

			expect(mockSend).toHaveBeenCalledTimes(2)

			// Verify the request format for both texts
			const firstCommand = mockSend.mock.calls[0][0] as any
			const firstBodyStr =
				typeof firstCommand.input.body === "string"
					? firstCommand.input.body
					: new TextDecoder().decode(firstCommand.input.body as Uint8Array)
			// Nova multimodal embeddings use a task-based format with nested text object
			expect(JSON.parse(firstBodyStr || "{}")).toEqual({
				taskType: "SINGLE_EMBEDDING",
				singleEmbeddingParams: {
					embeddingPurpose: "GENERIC_INDEX",
					embeddingDimension: 1024,
					text: {
						truncationMode: "END",
						value: "Hello world",
					},
				},
			})

			const secondCommand = mockSend.mock.calls[1][0] as any
			const secondBodyStr =
				typeof secondCommand.input.body === "string"
					? secondCommand.input.body
					: new TextDecoder().decode(secondCommand.input.body as Uint8Array)
			expect(JSON.parse(secondBodyStr || "{}")).toEqual({
				taskType: "SINGLE_EMBEDDING",
				singleEmbeddingParams: {
					embeddingPurpose: "GENERIC_INDEX",
					embeddingDimension: 1024,
					text: {
						truncationMode: "END",
						value: "Another text",
					},
				},
			})

			expect(result).toEqual({
				embeddings: [
					[0.1, 0.2, 0.3],
					[0.4, 0.5, 0.6],
				],
				usage: { promptTokens: 5, totalTokens: 5 },
			})
		})

		it("should use custom model when provided", async () => {
			const testTexts = ["Hello world"]
			const customModel = "amazon.titan-embed-text-v1"
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embedding: [0.1, 0.2, 0.3],
						inputTextTokenCount: 2,
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			await embedder.createEmbeddings(testTexts, customModel)

			const command = mockSend.mock.calls[0][0] as InvokeModelCommand
			expect(command.input.modelId).toBe(customModel)
		})

		it("should handle missing token count data gracefully", async () => {
			const testTexts = ["Hello world"]
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embedding: [0.1, 0.2, 0.3],
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await embedder.createEmbeddings(testTexts)

			expect(result).toEqual({
				embeddings: [[0.1, 0.2, 0.3]],
				usage: { promptTokens: 0, totalTokens: 0 },
			})
		})

		/**
		 * Test batching logic when texts exceed token limits
		 */
		describe("batching logic", () => {
			it("should warn and skip texts exceeding maximum token limit", async () => {
				// Create a text that exceeds MAX_ITEM_TOKENS (4 characters ≈ 1 token)
				const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
				const normalText = "normal text"
				const testTexts = [normalText, oversizedText, "another normal"]

				const mockResponses = [
					{
						body: new TextEncoder().encode(
							JSON.stringify({
								embedding: [0.1, 0.2, 0.3],
								inputTextTokenCount: 3,
							}),
						),
					},
					{
						body: new TextEncoder().encode(
							JSON.stringify({
								embedding: [0.4, 0.5, 0.6],
								inputTextTokenCount: 3,
							}),
						),
					},
				]

				mockSend.mockResolvedValueOnce(mockResponses[0]).mockResolvedValueOnce(mockResponses[1])

				const result = await embedder.createEmbeddings(testTexts)

				// Verify warning was logged
				expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("exceeds maximum token limit"))

				// Verify only normal texts were processed
				expect(mockSend).toHaveBeenCalledTimes(2)
				expect(result.embeddings).toHaveLength(2)
			})

			it("should handle all texts being skipped due to size", async () => {
				const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
				const testTexts = [oversizedText, oversizedText]

				const result = await embedder.createEmbeddings(testTexts)

				expect(console.warn).toHaveBeenCalledTimes(2)
				expect(mockSend).not.toHaveBeenCalled()
				expect(result).toEqual({
					embeddings: [],
					usage: { promptTokens: 0, totalTokens: 0 },
				})
			})
		})

		/**
		 * Test retry logic for rate limiting and other errors
		 */
		describe("retry logic", () => {
			beforeEach(() => {
				vitest.useFakeTimers()
			})

			afterEach(() => {
				vitest.useRealTimers()
			})

			it("should retry on throttling errors with exponential backoff", async () => {
				const testTexts = ["Hello world"]
				const throttlingError = new Error("Rate limit exceeded")
				throttlingError.name = "ThrottlingException"

				mockSend
					.mockRejectedValueOnce(throttlingError)
					.mockRejectedValueOnce(throttlingError)
					.mockResolvedValueOnce({
						body: new TextEncoder().encode(
							JSON.stringify({
								embedding: [0.1, 0.2, 0.3],
								inputTextTokenCount: 2,
							}),
						),
					})

				const resultPromise = embedder.createEmbeddings(testTexts)

				// Fast-forward through the delays
				await vitest.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS) // First retry delay
				await vitest.advanceTimersByTimeAsync(INITIAL_RETRY_DELAY_MS * 2) // Second retry delay

				const result = await resultPromise

				expect(mockSend).toHaveBeenCalledTimes(3)
				expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Rate limit hit, retrying in"))
				expect(result).toEqual({
					embeddings: [[0.1, 0.2, 0.3]],
					usage: { promptTokens: 2, totalTokens: 2 },
				})
			})

			it("should not retry on non-throttling errors", async () => {
				const testTexts = ["Hello world"]
				const authError = new Error("Unauthorized")
				authError.name = "UnrecognizedClientException"

				mockSend.mockRejectedValue(authError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Unauthorized",
				)

				expect(mockSend).toHaveBeenCalledTimes(1)
				expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining("Rate limit hit"))
			})
		})

		/**
		 * Test error handling scenarios
		 */
		describe("error handling", () => {
			it("should handle API errors gracefully", async () => {
				const testTexts = ["Hello world"]
				const apiError = new Error("API connection failed")

				mockSend.mockRejectedValue(apiError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: API connection failed",
				)

				expect(console.error).toHaveBeenCalledWith(
					expect.stringContaining("Bedrock embedder error"),
					expect.any(Error),
				)
			})

			it("should handle empty text arrays", async () => {
				const testTexts: string[] = []

				const result = await embedder.createEmbeddings(testTexts)

				expect(result).toEqual({
					embeddings: [],
					usage: { promptTokens: 0, totalTokens: 0 },
				})
				expect(mockSend).not.toHaveBeenCalled()
			})

			it("should handle malformed API responses", async () => {
				const testTexts = ["Hello world"]
				const malformedResponse = {
					body: new TextEncoder().encode("not json"),
				}

				mockSend.mockResolvedValue(malformedResponse)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow()
			})

			it("should handle AWS-specific errors", async () => {
				const testTexts = ["Hello world"]

				// Test UnrecognizedClientException
				const authError = new Error("Invalid credentials")
				authError.name = "UnrecognizedClientException"
				mockSend.mockRejectedValueOnce(authError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Invalid credentials",
				)

				// Test AccessDeniedException
				const accessError = new Error("Access denied")
				accessError.name = "AccessDeniedException"
				mockSend.mockRejectedValueOnce(accessError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Access denied",
				)

				// Test ResourceNotFoundException
				const notFoundError = new Error("Model not found")
				notFoundError.name = "ResourceNotFoundException"
				mockSend.mockRejectedValueOnce(notFoundError)

				await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
					"Failed to create embeddings after 3 attempts: Model not found",
				)
			})
		})
	})

	describe("validateConfiguration", () => {
		it("should validate successfully with valid configuration", async () => {
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						embedding: [0.1, 0.2, 0.3],
						inputTextTokenCount: 1,
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(true)
			expect(result.error).toBeUndefined()
			expect(mockSend).toHaveBeenCalled()
		})

		it("should fail validation with authentication error", async () => {
			const authError = new Error("Invalid credentials")
			authError.name = "UnrecognizedClientException"
			mockSend.mockRejectedValue(authError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("Invalid AWS credentials")
		})

		it("should fail validation with access denied error", async () => {
			const accessError = new Error("Access denied")
			accessError.name = "AccessDeniedException"
			mockSend.mockRejectedValue(accessError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("Access denied to Bedrock service")
		})

		it("should fail validation with model not found error", async () => {
			const notFoundError = new Error("Model not found")
			notFoundError.name = "ResourceNotFoundException"
			mockSend.mockRejectedValue(notFoundError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toContain("not found")
		})

		it("should fail validation with invalid response", async () => {
			const mockResponse = {
				body: new TextEncoder().encode(
					JSON.stringify({
						// Missing embedding field
						inputTextTokenCount: 1,
					}),
				),
			}
			mockSend.mockResolvedValue(mockResponse)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("Invalid response format from Bedrock")
		})

		it("should fail validation with connection error", async () => {
			const connectionError = new Error("ECONNREFUSED")
			mockSend.mockRejectedValue(connectionError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("Connection failed")
		})

		it("should fail validation with generic error", async () => {
			const genericError = new Error("Unknown error")
			mockSend.mockRejectedValue(genericError)

			const result = await embedder.validateConfiguration()

			expect(result.valid).toBe(false)
			expect(result.error).toBe("Configuration error")
		})
	})
})
