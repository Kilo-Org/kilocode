import { describe, test, expect, beforeEach, mock } from "bun:test"
import { mockEmbeddingsCreate, openAIMockFactory } from "./__helpers__/openai-mock"

// RATIONALE: Test MistralEmbedder through the real OpenAICompatibleEmbedder with mocked OpenAI SDK.
// Mocking the openai-compatible module with mock.module() is process-wide in Bun and would
// interfere with openai-compatible.test.ts which needs the real implementation.
mock.module("openai", openAIMockFactory)

import { MistralEmbedder } from "../../../../src/indexing/embedders/mistral"

describe("MistralEmbedder", () => {
  let embedder: MistralEmbedder

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
  })

  describe("constructor", () => {
    test("should create an instance with default model", () => {
      embedder = new MistralEmbedder("test-mistral-api-key")
      expect(embedder).toBeDefined()
    })

    test("should create an instance with specified model", () => {
      embedder = new MistralEmbedder("test-mistral-api-key", "custom-embed-model")
      expect(embedder).toBeDefined()
    })

    test("should throw error when API key is not provided", () => {
      expect(() => new MistralEmbedder("")).toThrow("API key is required for Mistral embedder")
      expect(() => new MistralEmbedder(null as any)).toThrow("API key is required for Mistral embedder")
      expect(() => new MistralEmbedder(undefined as any)).toThrow("API key is required for Mistral embedder")
    })
  })

  describe("embedderInfo", () => {
    test("should return correct embedder info", () => {
      embedder = new MistralEmbedder("test-api-key")

      expect(embedder.embedderInfo).toEqual({
        name: "mistral",
      })
    })
  })

  describe("createEmbeddings", () => {
    test("should use default model when no model parameter provided", async () => {
      embedder = new MistralEmbedder("test-api-key")
      const texts = ["test text 1", "test text 2"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(texts)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: texts,
        model: "codestral-embed-2505",
        encoding_format: "base64",
      })
      expect(result.embeddings).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ])
    })

    test("should use provided model parameter when specified", async () => {
      embedder = new MistralEmbedder("test-api-key", "custom-embed-model")
      const texts = ["test text 1"]
      const mockResponse = {
        data: [{ embedding: [0.5, 0.6] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(texts, "codestral-embed-2505")

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: texts,
        model: "codestral-embed-2505",
        encoding_format: "base64",
      })
      expect(result.embeddings).toEqual([[0.5, 0.6]])
    })

    test("should handle errors from embedding API", async () => {
      embedder = new MistralEmbedder("test-api-key")
      const error = new Error("Embedding failed")
      mockEmbeddingsCreate.mockRejectedValue(error)

      await expect(embedder.createEmbeddings(["test text"])).rejects.toThrow()
    })
  })

  describe("validateConfiguration", () => {
    test("should validate successfully with valid configuration", async () => {
      embedder = new MistralEmbedder("test-api-key")
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      })

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test("should fail validation with authentication error", async () => {
      embedder = new MistralEmbedder("test-api-key")
      const authError = new Error("Invalid API key")
      ;(authError as any).status = 401
      mockEmbeddingsCreate.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Authentication failed. Please check your API key.")
    })

    test("should handle validation exceptions", async () => {
      embedder = new MistralEmbedder("test-api-key")
      const error = new Error("ECONNREFUSED")
      mockEmbeddingsCreate.mockRejectedValue(error)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Connection failed")
    })
  })
})
