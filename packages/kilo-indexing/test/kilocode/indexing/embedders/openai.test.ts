import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import {
  MAX_ITEM_TOKENS,
  REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../../../../src/indexing/constants"
import { mockEmbeddingsCreate, openAIMockFactory } from "./__helpers__/openai-mock"

mock.module("openai", openAIMockFactory)

import { OpenAiEmbedder } from "../../../../src/indexing/embedders/openai"

describe("OpenAiEmbedder", () => {
  let embedder: OpenAiEmbedder

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()

    embedder = new OpenAiEmbedder("test-api-key", "text-embedding-3-small")
  })

  afterEach(() => {
    mockEmbeddingsCreate.mockReset()
  })

  describe("constructor", () => {
    test("should initialize with provided options", () => {
      expect(embedder.embedderInfo.name).toBe("openai")
    })

    test("should use default model if not specified", () => {
      const embedderWithDefaultModel = new OpenAiEmbedder("test-api-key")
      expect(embedderWithDefaultModel).toBeDefined()
    })
  })

  describe("createEmbeddings", () => {
    const testModelId = "text-embedding-3-small"

    test("should create embeddings for a single text", async () => {
      const testTexts = ["Hello world"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(testTexts)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: testTexts,
        model: testModelId,
      })
      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 10, totalTokens: 15 },
      })
    })

    test("should create embeddings for multiple texts", async () => {
      const testTexts = ["Hello world", "Another text"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        usage: { prompt_tokens: 20, total_tokens: 30 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(testTexts)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: testTexts,
        model: testModelId,
      })
      expect(result).toEqual({
        embeddings: [
          [0.1, 0.2, 0.3],
          [0.4, 0.5, 0.6],
        ],
        usage: { promptTokens: 20, totalTokens: 30 },
      })
    })

    test("should use custom model when provided", async () => {
      const testTexts = ["Hello world"]
      const customModel = "text-embedding-ada-002"
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      await embedder.createEmbeddings(testTexts, customModel)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: testTexts,
        model: customModel,
      })
    })

    test("should handle missing usage data gracefully", async () => {
      const testTexts = ["Hello world"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: undefined,
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

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
      test("should process texts in batches", async () => {
        // Use normal sized texts that won't be skipped
        const testTexts = ["text1", "text2", "text3"]

        mockEmbeddingsCreate.mockResolvedValue({
          data: testTexts.map((_, i) => ({ embedding: [i, i + 0.1, i + 0.2] })),
          usage: { prompt_tokens: 30, total_tokens: 45 },
        })

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
        expect(result.embeddings).toHaveLength(3)
        expect(result.usage?.promptTokens).toBe(30)
      })

      test("should skip texts exceeding maximum token limit", async () => {
        // Create a text that exceeds MAX_ITEM_TOKENS (4 characters ~ 1 token)
        const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
        const normalText = "normal text"
        const testTexts = [normalText, oversizedText, "another normal"]

        mockEmbeddingsCreate.mockResolvedValue({
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
          usage: { prompt_tokens: 20, total_tokens: 30 },
        })

        const result = await embedder.createEmbeddings(testTexts)

        // Verify only normal texts were processed
        expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
          input: [normalText, "another normal"],
          model: testModelId,
        })
        expect(result.embeddings).toHaveLength(2)
      })

      test("should handle multiple batches when total tokens exceed batch limit", async () => {
        // Create texts that will require multiple batches
        // Each text needs to be less than MAX_ITEM_TOKENS (8191) but together exceed MAX_BATCH_TOKENS (100000)
        // Let's use 8000 tokens per text (safe under MAX_ITEM_TOKENS)
        const tokensPerText = 8000
        const largeText = "a".repeat(tokensPerText * 4) // 4 chars ~ 1 token
        // Create 15 texts * 8000 tokens = 120000 tokens total
        const testTexts = Array(15).fill(largeText)

        // Mock responses for each batch
        // First batch will have 12 texts (96000 tokens), second batch will have 3 texts (24000 tokens)
        mockEmbeddingsCreate
          .mockResolvedValueOnce({
            data: Array(12)
              .fill(null)
              .map((_, i) => ({ embedding: [i * 0.1, i * 0.1 + 0.1, i * 0.1 + 0.2] })),
            usage: { prompt_tokens: 96000, total_tokens: 96000 },
          })
          .mockResolvedValueOnce({
            data: Array(3)
              .fill(null)
              .map((_, i) => ({
                embedding: [(12 + i) * 0.1, (12 + i) * 0.1 + 0.1, (12 + i) * 0.1 + 0.2],
              })),
            usage: { prompt_tokens: 24000, total_tokens: 24000 },
          })

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2)
        expect(result.embeddings).toHaveLength(15)
        expect(result.usage?.promptTokens).toBe(120000)
        expect(result.usage?.totalTokens).toBe(120000)
      })

      test("should handle all texts being skipped due to size", async () => {
        const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 4 + 100)
        const testTexts = [oversizedText, oversizedText]

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
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
      // TODO: bun:test doesn't support fake timers
      test.skip("should retry on rate limit errors with exponential backoff", async () => {
        const testTexts = ["Hello world"]
        const rateLimitError = { status: 429, message: "Rate limit exceeded" }

        mockEmbeddingsCreate
          .mockRejectedValueOnce(rateLimitError)
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce({
            data: [{ embedding: [0.1, 0.2, 0.3] }],
            usage: { prompt_tokens: 10, total_tokens: 15 },
          })

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3)
        expect(result).toEqual({
          embeddings: [[0.1, 0.2, 0.3]],
          usage: { promptTokens: 10, totalTokens: 15 },
        })
      })

      test("should not retry on non-rate-limit errors", async () => {
        const testTexts = ["Hello world"]
        const authError = new Error("Unauthorized")
        ;(authError as any).status = 401

        mockEmbeddingsCreate.mockRejectedValue(authError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Authentication failed. Please check your API key.",
        )

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
      })

      test("should throw error immediately on non-retryable errors", async () => {
        const testTexts = ["Hello world"]
        const serverError = new Error("Internal server error")
        ;(serverError as any).status = 500

        mockEmbeddingsCreate.mockRejectedValue(serverError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts with status 500: Internal server error",
        )

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
      })
    })

    /**
     * Test error handling scenarios
     */
    describe("error handling", () => {
      test("should handle API errors gracefully", async () => {
        const testTexts = ["Hello world"]
        const apiError = new Error("API connection failed")

        mockEmbeddingsCreate.mockRejectedValue(apiError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: API connection failed",
        )
      })

      test("should handle empty text arrays", async () => {
        const testTexts: string[] = []

        const result = await embedder.createEmbeddings(testTexts)

        expect(result).toEqual({
          embeddings: [],
          usage: { promptTokens: 0, totalTokens: 0 },
        })
        expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
      })

      test("should handle malformed API responses", async () => {
        const testTexts = ["Hello world"]
        const malformedResponse = {
          data: null,
          usage: { prompt_tokens: 10, total_tokens: 15 },
        }

        mockEmbeddingsCreate.mockResolvedValue(malformedResponse)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow()
      })

      test("should provide specific authentication error message", async () => {
        const testTexts = ["Hello world"]
        const authError = new Error("Invalid API key")
        ;(authError as any).status = 401

        mockEmbeddingsCreate.mockRejectedValue(authError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Authentication failed. Please check your API key.",
        )
      })

      test("should provide detailed error message for HTTP errors", async () => {
        const testTexts = ["Hello world"]
        const httpError = new Error("Bad request")
        ;(httpError as any).status = 400

        mockEmbeddingsCreate.mockRejectedValue(httpError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts with status 400: Bad request",
        )
      })

      test("should handle errors without status codes", async () => {
        const testTexts = ["Hello world"]
        const networkError = new Error("Network timeout")

        mockEmbeddingsCreate.mockRejectedValue(networkError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Network timeout",
        )
      })

      test("should handle errors without message property", async () => {
        const testTexts = ["Hello world"]
        const weirdError = { toString: () => "Custom error object" }

        mockEmbeddingsCreate.mockRejectedValue(weirdError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Custom error object",
        )
      })

      test("should handle completely unknown error types", async () => {
        const testTexts = ["Hello world"]
        const unknownError = null

        mockEmbeddingsCreate.mockRejectedValue(unknownError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Unknown error",
        )
      })

      test("should handle string errors", async () => {
        const testTexts = ["Hello world"]
        const stringError = "Something went wrong"

        mockEmbeddingsCreate.mockRejectedValue(stringError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Something went wrong",
        )
      })

      test("should handle errors with failing toString method", async () => {
        const testTexts = ["Hello world"]
        const errorWithFailingToString = {
          toString: () => {
            throw new Error("toString failed")
          },
        }

        mockEmbeddingsCreate.mockRejectedValue(errorWithFailingToString)

        // The error handler catches the failing toString and falls back to "Unknown error"
        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow()
      })

      test("should handle errors from response.status property", async () => {
        const testTexts = ["Hello world"]
        const errorWithResponseStatus = {
          message: "Request failed",
          response: { status: 403 },
        }

        mockEmbeddingsCreate.mockRejectedValue(errorWithResponseStatus)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts with status 403: Request failed",
        )
      })
    })
  })

  describe("validateConfiguration", () => {
    test("should validate successfully with valid configuration", async () => {
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        {
          input: ["test"],
          model: "text-embedding-3-small",
        },
        {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        },
      )
    })

    test("should fail validation with authentication error", async () => {
      const authError = new Error("Invalid API key")
      ;(authError as any).status = 401
      mockEmbeddingsCreate.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Authentication failed. Please check your API key.")
    })

    test("should fail validation with rate limit error", async () => {
      const rateLimitError = new Error("Rate limit exceeded")
      ;(rateLimitError as any).status = 429
      mockEmbeddingsCreate.mockRejectedValue(rateLimitError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Service is temporarily unavailable due to rate limiting. Please try again later.")
    })

    test("should fail validation with connection error", async () => {
      const connectionError = new Error("ECONNREFUSED")
      mockEmbeddingsCreate.mockRejectedValue(connectionError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Connection failed. Please check the endpoint URL and network connectivity.")
    })

    test("should fail validation with generic error", async () => {
      const genericError = new Error("Unknown error")
      ;(genericError as any).status = 500
      mockEmbeddingsCreate.mockRejectedValue(genericError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Configuration error. Please verify your embedder settings.")
    })
  })
})
