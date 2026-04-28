import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mockEmbeddingsCreate, openAIMockFactory } from "./__helpers__/openai-mock"

mock.module("openai", openAIMockFactory)

import { OpenRouterEmbedder, OPENROUTER_DEFAULT_PROVIDER_NAME } from "../../../../src/indexing/embedders/openrouter"
import {
  REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
  REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
} from "../../../../src/indexing/constants"
import { getModelDimension, getDefaultModelId } from "../../../../src/indexing/model-registry"
import { DEFAULT_HEADERS } from "../../../../src/headers"

describe("OpenRouterEmbedder", () => {
  const mockApiKey = "test-api-key"

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
  })

  describe("constructor", () => {
    test("should create an instance with valid API key", () => {
      const embedder = new OpenRouterEmbedder(mockApiKey)
      expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
    })

    test("should throw error with empty API key", () => {
      expect(() => new OpenRouterEmbedder("")).toThrow("API key is required")
    })

    test("should use default model when none specified", () => {
      const embedder = new OpenRouterEmbedder(mockApiKey)
      expect(embedder.embedderInfo.name).toBe("openrouter")
    })

    test("should use custom model when specified", () => {
      const customModel = "openai/text-embedding-3-small"
      const embedder = new OpenRouterEmbedder(mockApiKey, customModel)
      expect(embedder.embedderInfo.name).toBe("openrouter")
    })

    test("should accept specificProvider parameter", () => {
      const embedder = new OpenRouterEmbedder(mockApiKey, undefined, undefined, "together")
      expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
    })

    test("should ignore default provider name as specificProvider", () => {
      const embedder = new OpenRouterEmbedder(mockApiKey, undefined, undefined, OPENROUTER_DEFAULT_PROVIDER_NAME)
      expect(embedder).toBeInstanceOf(OpenRouterEmbedder)
    })
  })

  describe("embedderInfo", () => {
    test("should return correct embedder info", () => {
      const embedder = new OpenRouterEmbedder(mockApiKey)
      expect(embedder.embedderInfo).toEqual({
        name: "openrouter",
      })
    })
  })

  describe("createEmbeddings", () => {
    let embedder: OpenRouterEmbedder
    const defaultModel = getDefaultModelId("openrouter")

    beforeEach(() => {
      embedder = new OpenRouterEmbedder(mockApiKey)
    })

    test("should create embeddings successfully", async () => {
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
        model: defaultModel,
        encoding_format: "base64",
      })
      expect(result.embeddings).toHaveLength(1)
      expect(result.embeddings[0]).toEqual([0.25, 0.5, 0.75])
      expect(result.usage?.promptTokens).toBe(5)
      expect(result.usage?.totalTokens).toBe(5)
    })

    test("should handle multiple texts", async () => {
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

    test("should use custom model when provided", async () => {
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

    test("should include provider routing when specificProvider is set", async () => {
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
        model: defaultModel,
        encoding_format: "base64",
        provider: {
          order: [specificProvider],
          only: [specificProvider],
          allow_fallbacks: false,
        },
      })
    })

    test("should include dimensions when configured", async () => {
      const embedderWithDimensions = new OpenRouterEmbedder(mockApiKey, undefined, undefined, undefined, 1024)

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

      await embedderWithDimensions.createEmbeddings(["test"])

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: ["test"],
        model: defaultModel,
        encoding_format: "base64",
        dimensions: 1024,
      })
    })

    test("should not include provider routing when specificProvider is default", async () => {
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
        model: defaultModel,
        encoding_format: "base64",
      })
    })
  })

  describe("validateConfiguration", () => {
    let embedder: OpenRouterEmbedder
    const defaultModel = getDefaultModelId("openrouter")

    beforeEach(() => {
      embedder = new OpenRouterEmbedder(mockApiKey)
    })

    test("should validate configuration successfully", async () => {
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
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        {
          input: ["test"],
          model: defaultModel,
          encoding_format: "base64",
        },
        {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        },
      )
    })

    test("should handle validation failure", async () => {
      const authError = new Error("Invalid API key")
      ;(authError as any).status = 401

      mockEmbeddingsCreate.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Authentication failed. Please check your API key.")
    })

    test("should validate configuration with specificProvider", async () => {
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
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        {
          input: ["test"],
          model: defaultModel,
          encoding_format: "base64",
          provider: {
            order: [specificProvider],
            only: [specificProvider],
            allow_fallbacks: false,
          },
        },
        {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        },
      )
    })

    test("should include dimensions in validation when configured", async () => {
      const embedderWithDimensions = new OpenRouterEmbedder(mockApiKey, undefined, undefined, undefined, 1024)

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

      const result = await embedderWithDimensions.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
        {
          input: ["test"],
          model: defaultModel,
          encoding_format: "base64",
          dimensions: 1024,
        },
        {
          timeout: REMOTE_EMBEDDER_VALIDATION_TIMEOUT_MS,
          maxRetries: REMOTE_EMBEDDER_VALIDATION_MAX_RETRIES,
        },
      )
    })
  })

  describe("integration with shared models", () => {
    test("should work with defined OpenRouter models", () => {
      // Only models present in the new model-registry
      const openRouterModels = ["openai/text-embedding-3-small", "openai/text-embedding-3-large"]

      openRouterModels.forEach((model) => {
        const dimension = getModelDimension("openrouter", model)
        expect(dimension).toBeDefined()
        expect(dimension).toBeGreaterThan(0)

        const embedder = new OpenRouterEmbedder(mockApiKey, model)
        expect(embedder.embedderInfo.name).toBe("openrouter")
      })
    })

    test("should use correct default model", () => {
      const defaultModel = getDefaultModelId("openrouter")
      expect(defaultModel).toBe("openai/text-embedding-3-small")

      const dimension = getModelDimension("openrouter", defaultModel)
      expect(dimension).toBe(1536)
    })
  })
})
