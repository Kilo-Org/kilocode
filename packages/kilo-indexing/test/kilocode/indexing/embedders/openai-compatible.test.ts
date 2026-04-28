import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import {
  MAX_ITEM_TOKENS,
  REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../../../../src/indexing/constants"
import { mockEmbeddingsCreate, setOpenAIConstructorHook, openAIMockFactory } from "./__helpers__/openai-mock"

mock.module("openai", openAIMockFactory)

import { OpenAICompatibleEmbedder } from "../../../../src/indexing/embedders/openai-compatible"

// Mock global fetch
const mockFetch = mock() as any
global.fetch = mockFetch

describe("OpenAICompatibleEmbedder", () => {
  let embedder: OpenAICompatibleEmbedder

  const testBaseUrl = "https://api.example.com/v1"
  const testApiKey = "test-api-key"
  const testModelId = "text-embedding-3-small"

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
    mockFetch.mockReset()
    setOpenAIConstructorHook(undefined)

    // Reset global rate limit state to prevent interference between tests
    const tempEmbedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    ;(tempEmbedder as any).constructor.globalRateLimitState = {
      isRateLimited: false,
      rateLimitResetTime: 0,
      consecutiveRateLimitErrors: 0,
      lastRateLimitError: 0,
      mutex: (tempEmbedder as any).constructor.globalRateLimitState.mutex,
    }
  })

  afterEach(() => {
    mockEmbeddingsCreate.mockReset()
    mockFetch.mockReset()
    setOpenAIConstructorHook(undefined)
  })

  describe("constructor", () => {
    test("should create embedder with valid configuration", () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

      expect(embedder).toBeDefined()
    })

    test("should use default model when modelId is not provided", () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey)

      expect(embedder).toBeDefined()
    })

    test("should throw error when baseUrl is missing", () => {
      expect(() => new OpenAICompatibleEmbedder("", testApiKey, testModelId)).toThrow(
        "Base URL is required for OpenAI-compatible embedder",
      )
    })

    test("should throw error when apiKey is missing", () => {
      expect(() => new OpenAICompatibleEmbedder(testBaseUrl, "", testModelId)).toThrow(
        "API key is required for OpenAI-compatible embedder",
      )
    })

    test("should throw error when both baseUrl and apiKey are missing", () => {
      expect(() => new OpenAICompatibleEmbedder("", "", testModelId)).toThrow(
        "Base URL is required for OpenAI-compatible embedder",
      )
    })

    test("should handle API key with invalid characters (ByteString conversion error)", () => {
      const invalidApiKey = "sk-test\u2022invalid" // Contains bullet character (U+2022)
      const byteStringError = new Error(
        "Cannot convert argument to a ByteString because the character at index 7 has a value of 8226 which is greater than 255.",
      )

      // Make the mock OpenAI constructor throw
      setOpenAIConstructorHook(() => {
        throw byteStringError
      })

      expect(() => new OpenAICompatibleEmbedder(testBaseUrl, invalidApiKey, testModelId)).toThrow(
        "Cannot convert argument to a ByteString",
      )
    })
  })

  describe("embedderInfo", () => {
    beforeEach(() => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    })

    test("should return correct embedder info", () => {
      const info = embedder.embedderInfo

      expect(info).toEqual({
        name: "openai-compatible",
      })
    })
  })

  describe("createEmbeddings", () => {
    beforeEach(() => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)
    })

    test("should create embeddings for single text", async () => {
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
        encoding_format: "base64",
      })
      expect(result).toEqual({
        embeddings: [[0.1, 0.2, 0.3]],
        usage: { promptTokens: 10, totalTokens: 15 },
      })
    })

    test("should create embeddings for multiple texts", async () => {
      const testTexts = ["Hello world", "Goodbye world"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
        usage: { prompt_tokens: 20, total_tokens: 30 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(testTexts)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: testTexts,
        model: testModelId,
        encoding_format: "base64",
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
      const customModel = "custom-embedding-model"
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      await embedder.createEmbeddings(testTexts, customModel)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: testTexts,
        model: customModel,
        encoding_format: "base64",
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
     * Test base64 conversion logic
     */
    describe("base64 conversion", () => {
      test("should convert base64 encoded embeddings to float arrays", async () => {
        const testTexts = ["Hello world"]

        // Create a Float32Array with test values that can be exactly represented in Float32
        const testEmbedding = new Float32Array([0.25, 0.5, 0.75, 1.0])

        // Convert to base64 string (simulating what OpenAI API returns)
        const buffer = Buffer.from(testEmbedding.buffer)
        const base64String = buffer.toString("base64")

        const mockResponse = {
          data: [{ embedding: base64String }], // Base64 string instead of array
          usage: { prompt_tokens: 10, total_tokens: 15 },
        }
        mockEmbeddingsCreate.mockResolvedValue(mockResponse)

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
          input: testTexts,
          model: testModelId,
          encoding_format: "base64",
        })

        // Verify the base64 string was converted back to the original float array
        expect(result).toEqual({
          embeddings: [[0.25, 0.5, 0.75, 1.0]],
          usage: { promptTokens: 10, totalTokens: 15 },
        })
      })

      test("should handle multiple base64 encoded embeddings", async () => {
        const testTexts = ["Hello world", "Goodbye world"]

        // Create test embeddings with values that can be exactly represented in Float32
        const embedding1 = new Float32Array([0.25, 0.5, 0.75])
        const embedding2 = new Float32Array([1.0, 1.25, 1.5])

        // Convert to base64 strings
        const base64String1 = Buffer.from(embedding1.buffer).toString("base64")
        const base64String2 = Buffer.from(embedding2.buffer).toString("base64")

        const mockResponse = {
          data: [{ embedding: base64String1 }, { embedding: base64String2 }],
          usage: { prompt_tokens: 20, total_tokens: 30 },
        }
        mockEmbeddingsCreate.mockResolvedValue(mockResponse)

        const result = await embedder.createEmbeddings(testTexts)

        expect(result).toEqual({
          embeddings: [
            [0.25, 0.5, 0.75],
            [1.0, 1.25, 1.5],
          ],
          usage: { promptTokens: 20, totalTokens: 30 },
        })
      })

      test("should handle mixed base64 and array embeddings", async () => {
        const testTexts = ["Hello world", "Goodbye world"]

        // Create one base64 embedding and one regular array (edge case)
        const embedding1 = new Float32Array([0.25, 0.5, 0.75])
        const base64String1 = Buffer.from(embedding1.buffer).toString("base64")

        const mockResponse = {
          data: [
            { embedding: base64String1 }, // Base64 string
            { embedding: [1.0, 1.25, 1.5] }, // Regular array
          ],
          usage: { prompt_tokens: 20, total_tokens: 30 },
        }
        mockEmbeddingsCreate.mockResolvedValue(mockResponse)

        const result = await embedder.createEmbeddings(testTexts)

        expect(result).toEqual({
          embeddings: [
            [0.25, 0.5, 0.75],
            [1.0, 1.25, 1.5],
          ],
          usage: { promptTokens: 20, totalTokens: 30 },
        })
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
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }, { embedding: [0.7, 0.8, 0.9] }],
          usage: { prompt_tokens: 10, total_tokens: 15 },
        })

        await embedder.createEmbeddings(testTexts)

        // Should be called once for normal texts
        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
      })

      test("should skip texts that exceed MAX_ITEM_TOKENS", async () => {
        const normalText = "Hello world"
        const oversizedText = "a".repeat(MAX_ITEM_TOKENS * 5) // Exceeds MAX_ITEM_TOKENS
        const testTexts = [normalText, oversizedText, normalText]

        const mockResponse = {
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
          usage: { prompt_tokens: 10, total_tokens: 15 },
        }
        mockEmbeddingsCreate.mockResolvedValue(mockResponse)

        await embedder.createEmbeddings(testTexts)

        // Should only process normal texts (1 call for 2 normal texts batched together)
        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1)
      })

      test("should return correct usage statistics", async () => {
        const testTexts = ["text1", "text2"]

        mockEmbeddingsCreate.mockResolvedValue({
          data: [{ embedding: [0.1, 0.2, 0.3] }, { embedding: [0.4, 0.5, 0.6] }],
          usage: { prompt_tokens: 10, total_tokens: 15 },
        })

        const result = await embedder.createEmbeddings(testTexts)

        expect(result.usage).toEqual({
          promptTokens: 10,
          totalTokens: 15,
        })
      })
    })

    /**
     * Test retry logic with exponential backoff
     */
    describe("retry logic", () => {
      // TODO: bun:test doesn't support fake timers
      test.skip("should retry on rate limit errors with exponential backoff", async () => {
        const testTexts = ["Hello world"]
        const rateLimitError = { status: 429, message: "Rate limit exceeded" }

        // Create base64 encoded embedding for successful response
        const testEmbedding = new Float32Array([0.25, 0.5, 0.75])
        const base64String = Buffer.from(testEmbedding.buffer).toString("base64")

        mockEmbeddingsCreate
          .mockRejectedValueOnce(rateLimitError)
          .mockRejectedValueOnce(rateLimitError)
          .mockResolvedValueOnce({
            data: [{ embedding: base64String }],
            usage: { prompt_tokens: 10, total_tokens: 15 },
          })

        const result = await embedder.createEmbeddings(testTexts)

        expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(3)
        expect(result).toEqual({
          embeddings: [[0.25, 0.5, 0.75]],
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

      test("should handle batch processing errors", async () => {
        const testTexts = ["text1", "text2"]
        const batchError = new Error("Batch processing failed")

        mockEmbeddingsCreate.mockRejectedValue(batchError)

        await expect(embedder.createEmbeddings(testTexts)).rejects.toThrow(
          "Embedding request failed after 3 attempts: Batch processing failed",
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
    })

    /**
     * Test to confirm OpenAI package bug with base64 encoding.
     * This test verifies that when we request encoding_format: "base64",
     * the OpenAI package returns unparsed base64 strings as expected.
     */
    describe("OpenAI package base64 behavior verification", () => {
      // TODO: bun:test doesn't support importActual
      test.skip("should return unparsed base64 when encoding_format is base64", async () => {
        // This test requires vi.importActual("openai") which is not available in bun:test
      })
    })

    /**
     * Test Azure OpenAI compatibility with helper functions for conciseness
     */
    describe("Azure OpenAI compatibility", () => {
      const azureUrl =
        "https://myresource.openai.azure.com/openai/deployments/mymodel/embeddings?api-version=2024-02-01"
      const baseUrl = "https://api.openai.com/v1"

      // Helper to create mock fetch response
      const createMockResponse = (data: any, status = 200, ok = true) => ({
        ok,
        status,
        json: mock().mockResolvedValue(data),
        text: mock().mockResolvedValue(status === 200 ? "" : "Error message"),
      })

      // Helper to create base64 embedding
      const createBase64Embedding = (values: number[]) => {
        const embedding = new Float32Array(values)
        return Buffer.from(embedding.buffer).toString("base64")
      }

      // Helper to verify embedding values with floating-point tolerance
      const expectEmbeddingValues = (actual: number[], expected: number[]) => {
        expect(actual).toHaveLength(expected.length)
        expected.forEach((val, i) => expect(actual[i]).toBeCloseTo(val, 5))
      }

      beforeEach(() => {
        mockEmbeddingsCreate.mockReset()
        mockFetch.mockReset()
      })

      describe("URL detection", () => {
        test.each([
          ["https://myresource.openai.azure.com/openai/deployments/mymodel/embeddings?api-version=2024-02-01", true],
          ["https://myresource.openai.azure.com/openai/deployments/text-embedding-ada-002/embeddings", true],
          ["https://api.openai.com/v1", false],
          ["https://api.example.com", false],
          ["http://localhost:8080", false],
        ])("should detect URL type correctly: %s -> %s", (url, expected) => {
          const embedder = new OpenAICompatibleEmbedder(url, testApiKey, testModelId)
          const isFullUrl = (embedder as any).isFullEndpointUrl(url)
          expect(isFullUrl).toBe(expected)
        })

        // Edge cases where 'embeddings' or 'deployments' appear in non-endpoint contexts
        test("should return false for URLs with 'embeddings' in non-endpoint contexts", () => {
          const testUrls = [
            "https://api.example.com/embeddings-service/v1",
            "https://embeddings.example.com/api",
            "https://api.example.com/v1/embeddings-api",
            "https://my-embeddings-provider.com/v1",
          ]

          testUrls.forEach((url) => {
            const embedder = new OpenAICompatibleEmbedder(url, testApiKey, testModelId)
            const isFullUrl = (embedder as any).isFullEndpointUrl(url)
            expect(isFullUrl).toBe(false)
          })
        })

        test("should return false for URLs with 'deployments' in non-endpoint contexts", () => {
          const testUrls = [
            "https://deployments.example.com/api",
            "https://api.deployments.com/v1",
            "https://my-deployments-service.com/api/v1",
            "https://deployments-manager.example.com",
          ]

          testUrls.forEach((url) => {
            const embedder = new OpenAICompatibleEmbedder(url, testApiKey, testModelId)
            const isFullUrl = (embedder as any).isFullEndpointUrl(url)
            expect(isFullUrl).toBe(false)
          })
        })

        test("should correctly identify actual endpoint URLs", () => {
          const endpointUrls = [
            "https://api.example.com/v1/embeddings",
            "https://api.example.com/v1/embeddings?api-version=2024",
            "https://myresource.openai.azure.com/openai/deployments/mymodel/embeddings",
            "https://api.example.com/embed",
            "https://api.example.com/embed?version=1",
          ]

          endpointUrls.forEach((url) => {
            const embedder = new OpenAICompatibleEmbedder(url, testApiKey, testModelId)
            const isFullUrl = (embedder as any).isFullEndpointUrl(url)
            expect(isFullUrl).toBe(true)
          })
        })
      })

      describe("direct HTTP requests", () => {
        test("should use direct fetch for Azure URLs and SDK for base URLs", async () => {
          const testTexts = ["Test text"]
          const base64String = createBase64Embedding([0.1, 0.2, 0.3])

          // Test Azure URL (direct fetch)
          const azureEmbedder = new OpenAICompatibleEmbedder(azureUrl, testApiKey, testModelId)
          const mockFetchResponse = createMockResponse({
            data: [{ embedding: base64String }],
            usage: { prompt_tokens: 10, total_tokens: 15 },
          })
          mockFetch.mockResolvedValue(mockFetchResponse as any)

          const azureResult = await azureEmbedder.createEmbeddings(testTexts)
          expect(mockFetch).toHaveBeenCalledWith(
            azureUrl,
            expect.objectContaining({
              method: "POST",
              headers: expect.objectContaining({
                "api-key": testApiKey,
                Authorization: `Bearer ${testApiKey}`,
              }),
            }),
          )
          expect(mockEmbeddingsCreate).not.toHaveBeenCalled()
          expectEmbeddingValues(azureResult.embeddings[0], [0.1, 0.2, 0.3])

          // Reset and test base URL (SDK)
          mockEmbeddingsCreate.mockReset()
          mockFetch.mockReset()
          const baseEmbedder = new OpenAICompatibleEmbedder(baseUrl, testApiKey, testModelId)
          mockEmbeddingsCreate.mockResolvedValue({
            data: [{ embedding: [0.4, 0.5, 0.6] }],
            usage: { prompt_tokens: 10, total_tokens: 15 },
          })

          const baseResult = await baseEmbedder.createEmbeddings(testTexts)
          expect(mockEmbeddingsCreate).toHaveBeenCalled()
          expect(mockFetch).not.toHaveBeenCalled()
          expect(baseResult.embeddings[0]).toEqual([0.4, 0.5, 0.6])
        })

        test.each([
          [401, "Authentication failed. Please check your API key."],
          [500, "Embedding request failed after 3 attempts"],
        ])("should handle HTTP errors: %d", async (status, expectedMessage) => {
          const embedder = new OpenAICompatibleEmbedder(azureUrl, testApiKey, testModelId)
          const mockResponse = createMockResponse({}, status, false)
          mockFetch.mockResolvedValue(mockResponse as any)

          await expect(embedder.createEmbeddings(["test"])).rejects.toThrow(expectedMessage)
        })

        // TODO: bun:test doesn't support fake timers
        test.skip("should handle rate limiting with retries", async () => {
          const embedder = new OpenAICompatibleEmbedder(azureUrl, testApiKey, testModelId)
          const base64String = createBase64Embedding([0.1, 0.2, 0.3])

          mockFetch
            .mockResolvedValueOnce(createMockResponse({}, 429, false) as any)
            .mockResolvedValueOnce(createMockResponse({}, 429, false) as any)
            .mockResolvedValueOnce(
              createMockResponse({
                data: [{ embedding: base64String }],
                usage: { prompt_tokens: 10, total_tokens: 15 },
              }) as any,
            )

          const result = await embedder.createEmbeddings(["test"])

          expect(mockFetch).toHaveBeenCalledTimes(3)
          expectEmbeddingValues(result.embeddings[0], [0.1, 0.2, 0.3])
        })

        test("should handle multiple embeddings and network errors", async () => {
          const embedder = new OpenAICompatibleEmbedder(azureUrl, testApiKey, testModelId)

          // Test multiple embeddings
          const base64_1 = createBase64Embedding([0.25, 0.5])
          const base64_2 = createBase64Embedding([0.75, 1.0])
          const mockResponse = createMockResponse({
            data: [{ embedding: base64_1 }, { embedding: base64_2 }],
            usage: { prompt_tokens: 20, total_tokens: 30 },
          })
          mockFetch.mockResolvedValue(mockResponse as any)

          const result = await embedder.createEmbeddings(["test1", "test2"])
          expect(result.embeddings).toHaveLength(2)
          expectEmbeddingValues(result.embeddings[0], [0.25, 0.5])
          expectEmbeddingValues(result.embeddings[1], [0.75, 1.0])

          // Test network error
          const networkError = new Error("Network failed")
          mockFetch.mockRejectedValue(networkError)
          await expect(embedder.createEmbeddings(["test"])).rejects.toThrow("Embedding request failed after 3 attempts")
        })
      })
    })
  })

  describe("URL detection", () => {
    test("should detect Azure deployment URLs as full endpoints", async () => {
      const embedder = new OpenAICompatibleEmbedder(
        "https://myinstance.openai.azure.com/openai/deployments/my-deployment/embeddings?api-version=2023-05-15",
        "test-key",
      )

      // The private method is tested indirectly through the createEmbeddings behavior
      // If it's detected as a full URL, it will make a direct HTTP request
      const localMockFetch = mock().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 10, total_tokens: 15 },
        }),
      })
      global.fetch = localMockFetch as any

      await embedder.createEmbeddings(["test"])

      // Should make direct HTTP request to the full URL
      expect(localMockFetch).toHaveBeenCalledWith(
        "https://myinstance.openai.azure.com/openai/deployments/my-deployment/embeddings?api-version=2023-05-15",
        expect.any(Object),
      )

      // Restore the module-level mock
      global.fetch = mockFetch
    })

    test("should detect /embed endpoints as full URLs", async () => {
      const embedder = new OpenAICompatibleEmbedder("https://api.example.com/v1/embed", "test-key")

      const localMockFetch = mock().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2] }],
          usage: { prompt_tokens: 10, total_tokens: 15 },
        }),
      })
      global.fetch = localMockFetch as any

      await embedder.createEmbeddings(["test"])

      // Should make direct HTTP request to the full URL
      expect(localMockFetch).toHaveBeenCalledWith("https://api.example.com/v1/embed", expect.any(Object))

      // Restore the module-level mock
      global.fetch = mockFetch
    })

    test("should treat base URLs without endpoint patterns as SDK URLs", async () => {
      const embedder = new OpenAICompatibleEmbedder("https://api.openai.com/v1", "test-key")

      // Mock the OpenAI SDK's embeddings.create method
      const localMockCreate = mock().mockResolvedValue({
        data: [{ embedding: [0.1, 0.2] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      })
      embedder["embeddingsClient"].embeddings = {
        create: localMockCreate,
      } as any

      await embedder.createEmbeddings(["test"])

      // Should use SDK which will append /embeddings
      expect(localMockCreate).toHaveBeenCalled()
    })
  })

  describe("validateConfiguration", () => {
    let embedder: OpenAICompatibleEmbedder

    beforeEach(() => {
      mockEmbeddingsCreate.mockReset()
      mockFetch.mockReset()
    })

    test("should validate successfully with valid configuration and base URL", async () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

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
          model: testModelId,
          encoding_format: "base64",
        },
        {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        },
      )
    })

    test("should validate successfully with full endpoint URL", async () => {
      const fullUrl = "https://api.example.com/v1/embeddings"
      embedder = new OpenAICompatibleEmbedder(fullUrl, testApiKey, testModelId)

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [{ embedding: [0.1, 0.2, 0.3] }],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
        text: async () => "",
      } as any)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledWith(
        fullUrl,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${testApiKey}`,
          }),
        }),
      )
    })

    test("should fail validation with authentication error", async () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

      const authError = new Error("Invalid API key")
      ;(authError as any).status = 401
      mockEmbeddingsCreate.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Authentication failed. Please check your API key.")
    })

    test("should fail validation with connection error", async () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

      const connectionError = new Error("ECONNREFUSED")
      mockEmbeddingsCreate.mockRejectedValue(connectionError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Connection failed. Please check the endpoint URL and network connectivity.")
    })

    test("should fail validation with invalid endpoint for full URL", async () => {
      const fullUrl = "https://api.example.com/v1/embeddings"
      embedder = new OpenAICompatibleEmbedder(fullUrl, testApiKey, testModelId)

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        json: async () => ({ error: "Not found" }),
        text: async () => "Not found",
      } as any)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      // 404 for non-openai embedder returns "Invalid endpoint URL. Please verify the endpoint."
      expect(result.error).toBe("Invalid endpoint URL. Please verify the endpoint.")
    })

    test("should fail validation with rate limit error", async () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

      const rateLimitError = new Error("Rate limit exceeded")
      ;(rateLimitError as any).status = 429
      mockEmbeddingsCreate.mockRejectedValue(rateLimitError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Service is temporarily unavailable due to rate limiting. Please try again later.")
    })

    test("should fail validation with generic error", async () => {
      embedder = new OpenAICompatibleEmbedder(testBaseUrl, testApiKey, testModelId)

      const genericError = new Error("Unknown error")
      ;(genericError as any).status = 500
      mockEmbeddingsCreate.mockRejectedValue(genericError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Configuration error. Please verify your embedder settings.")
    })
  })
})
