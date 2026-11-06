import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"

import { CodeIndexOllamaEmbedder } from "../../../../src/indexing/embedders/ollama"

const mockFetch = mock() as unknown as typeof fetch
global.fetch = mockFetch

describe("CodeIndexOllamaEmbedder", () => {
  let embedder: CodeIndexOllamaEmbedder

  beforeEach(() => {
    ;(mockFetch as any).mockReset()

    embedder = new CodeIndexOllamaEmbedder("http://localhost:11434", "nomic-embed-text")
  })

  afterEach(() => {
    ;(mockFetch as any).mockReset()
  })

  describe("constructor", () => {
    test("should initialize with provided options", () => {
      expect(embedder.embedderInfo.name).toBe("ollama")
    })

    test("should use default values when not provided", () => {
      const embedderWithDefaults = new CodeIndexOllamaEmbedder("")
      expect(embedderWithDefaults.embedderInfo.name).toBe("ollama")
    })

    test("should normalize URLs with trailing slashes", async () => {
      const embedderWithTrailingSlash = new CodeIndexOllamaEmbedder("http://localhost:11434/", "nomic-embed-text")

      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ models: [{ name: "nomic-embed-text" }] }),
        } as Response),
      )

      await embedderWithTrailingSlash.validateConfiguration()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/tags",
        expect.objectContaining({
          method: "GET",
        }),
      )
    })

    test("should not modify URLs without trailing slashes", async () => {
      const embedderWithoutTrailingSlash = new CodeIndexOllamaEmbedder("http://localhost:11434", "nomic-embed-text")

      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ models: [{ name: "nomic-embed-text" }] }),
        } as Response),
      )

      await embedderWithoutTrailingSlash.validateConfiguration()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/tags",
        expect.objectContaining({
          method: "GET",
        }),
      )
    })

    test("should handle multiple trailing slashes", async () => {
      const embedderWithMultipleTrailingSlashes = new CodeIndexOllamaEmbedder(
        "http://localhost:11434///",
        "nomic-embed-text",
      )

      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ models: [{ name: "nomic-embed-text" }] }),
        } as Response),
      )

      await embedderWithMultipleTrailingSlashes.validateConfiguration()

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:11434/api/tags",
        expect.objectContaining({
          method: "GET",
        }),
      )
    })
  })

  describe("validateConfiguration", () => {
    test("should validate successfully when service is available and model exists", async () => {
      // Mock successful /api/tags call
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              models: [{ name: "nomic-embed-text:latest" }, { name: "llama2:latest" }],
            }),
        } as Response),
      )

      // Mock successful /api/embed test call
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              embeddings: [[0.1, 0.2, 0.3]],
            }),
        } as Response),
      )

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(true)
      expect(result.error).toBeUndefined()
      expect(mockFetch).toHaveBeenCalledTimes(2)

      // Check first call (GET /api/tags)
      const firstCall = (mockFetch as any).mock.calls[0]
      expect(firstCall[0]).toBe("http://localhost:11434/api/tags")
      expect(firstCall[1]?.method).toBe("GET")
      expect(firstCall[1]?.headers).toEqual({ "Content-Type": "application/json" })
      expect(firstCall[1]?.signal).toBeDefined()

      // Check second call (POST /api/embed)
      const secondCall = (mockFetch as any).mock.calls[1]
      expect(secondCall[0]).toBe("http://localhost:11434/api/embed")
      expect(secondCall[1]?.method).toBe("POST")
      expect(secondCall[1]?.headers).toEqual({ "Content-Type": "application/json" })
      expect(secondCall[1]?.body).toBe(JSON.stringify({ model: "nomic-embed-text", input: ["test"] }))
      expect(secondCall[1]?.signal).toBeDefined()
    })

    test("should fail validation when service is not available", async () => {
      ;(mockFetch as any).mockRejectedValueOnce(new Error("ECONNREFUSED"))

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Ollama service is not running")
    })

    test("should fail validation when tags endpoint returns 404", async () => {
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 404,
        } as Response),
      )

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Ollama service is not running")
    })

    test("should fail validation when tags endpoint returns other error", async () => {
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 500,
        } as Response),
      )

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Ollama service unavailable")
    })

    test("should fail validation when model does not exist", async () => {
      // Mock successful /api/tags call with different models
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              models: [{ name: "llama2:latest" }, { name: "mistral:latest" }],
            }),
        } as Response),
      )

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("not found")
    })

    test("should fail validation when model exists but doesn't support embeddings", async () => {
      // Mock successful /api/tags call
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              models: [{ name: "nomic-embed-text" }],
            }),
        } as Response),
      )

      // Mock failed /api/embed test call
      ;(mockFetch as any).mockImplementationOnce(() =>
        Promise.resolve({
          ok: false,
          status: 400,
        } as Response),
      )

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("not capable of generating embeddings")
    })

    test("should handle ECONNREFUSED errors", async () => {
      ;(mockFetch as any).mockRejectedValueOnce(new Error("ECONNREFUSED"))

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Ollama service is not running")
    })

    test("should handle ENOTFOUND errors", async () => {
      ;(mockFetch as any).mockRejectedValueOnce(new Error("ENOTFOUND"))

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toContain("Ollama host not found")
    })

    test("should handle generic network errors", async () => {
      ;(mockFetch as any).mockRejectedValueOnce(new Error("Network timeout"))

      const result = await embedder.validateConfiguration()

      expect(result.valid).toBe(false)
      expect(result.error).toBe("Network timeout")
    })
  })
})
