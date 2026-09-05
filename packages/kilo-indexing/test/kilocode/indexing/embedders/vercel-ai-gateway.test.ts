import { describe, test, expect, beforeEach, mock } from "bun:test"
import { mockEmbeddingsCreate, openAIMockFactory } from "./__helpers__/openai-mock"

// RATIONALE: Test VercelAiGatewayEmbedder through the real OpenAICompatibleEmbedder with mocked OpenAI SDK.
// Mocking the openai-compatible module with mock.module() is process-wide in Bun and would
// interfere with openai-compatible.test.ts which needs the real implementation.
mock.module("openai", openAIMockFactory)

import { VercelAiGatewayEmbedder } from "../../../../src/indexing/embedders/vercel-ai-gateway"

describe("VercelAiGatewayEmbedder", () => {
  let embedder: VercelAiGatewayEmbedder

  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
  })

  describe("constructor", () => {
    test("should create VercelAiGatewayEmbedder with default model", () => {
      embedder = new VercelAiGatewayEmbedder("test-vercel-api-key")
      expect(embedder).toBeDefined()
    })

    test("should create VercelAiGatewayEmbedder with custom model", () => {
      embedder = new VercelAiGatewayEmbedder("test-vercel-api-key", "openai/text-embedding-3-small")
      expect(embedder).toBeDefined()
    })

    test("should throw error when API key is missing", () => {
      expect(() => new VercelAiGatewayEmbedder("")).toThrow("API key is required for Vercel AI Gateway embedder")
    })
  })

  describe("createEmbeddings", () => {
    beforeEach(() => {
      embedder = new VercelAiGatewayEmbedder("test-api-key")
    })

    test("should delegate to OpenAICompatibleEmbedder with default model", async () => {
      const texts = ["test text 1", "test text 2"]
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2] }, { embedding: [0.3, 0.4] }],
        usage: { prompt_tokens: 10, total_tokens: 15 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(texts)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: texts,
        model: "openai/text-embedding-3-large",
        encoding_format: "base64",
      })
      expect(result.embeddings).toEqual([
        [0.1, 0.2],
        [0.3, 0.4],
      ])
    })

    test("should delegate to OpenAICompatibleEmbedder with custom model", async () => {
      const texts = ["test text"]
      const customModel = "google/gemini-embedding-001"
      const mockResponse = {
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 5, total_tokens: 5 },
      }
      mockEmbeddingsCreate.mockResolvedValue(mockResponse)

      const result = await embedder.createEmbeddings(texts, customModel)

      expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
        input: texts,
        model: customModel,
        encoding_format: "base64",
      })
      expect(result.embeddings).toEqual([[0.1, 0.2, 0.3]])
    })

    test("should handle errors from OpenAICompatibleEmbedder", async () => {
      const texts = ["test text"]
      const error = new Error("API request failed")
      mockEmbeddingsCreate.mockRejectedValue(error)

      await expect(embedder.createEmbeddings(texts)).rejects.toThrow()
    })
  })

  describe("validateConfiguration", () => {
    beforeEach(() => {
      embedder = new VercelAiGatewayEmbedder("test-api-key")
    })

    test("should validate successfully", async () => {
      mockEmbeddingsCreate.mockResolvedValue({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 2, total_tokens: 2 },
      })

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
    })

    test("should handle validation errors", async () => {
      const authError = new Error("Invalid API key")
      ;(authError as any).status = 401
      mockEmbeddingsCreate.mockRejectedValue(authError)

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Authentication failed. Please check your API key.")
    })
  })

  describe("embedderInfo", () => {
    test("should return correct embedder info", () => {
      embedder = new VercelAiGatewayEmbedder("test-api-key")

      expect(embedder.embedderInfo).toEqual({
        name: "vercel-ai-gateway",
      })
    })
  })
})
