import { describe, expect, mock, test } from "bun:test"
import {
  BUNDLED_KILO_EMBEDDING_MODEL_CATALOG,
  EMPTY_KILO_EMBEDDING_MODEL_CATALOG,
  fetchKiloEmbeddingModelCatalog,
} from "../../src/api/embedding-models"

describe("fetchKiloEmbeddingModelCatalog", () => {
  test("fetches catalog from Kilo Gateway", async () => {
    const prev = global.fetch
    const fn = mock(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            defaultModel: "provider/model",
            models: [{ id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4 }],
            aliases: { model: "provider/model" },
          }),
        ),
      ),
    ) as unknown as typeof fetch
    global.fetch = fn

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test" })

      expect(catalog.defaultModel).toBe("provider/model")
      const call = (fn as unknown as { mock: { calls: Array<[URL, RequestInit]> } }).mock.calls[0]
      expect(call?.[0].toString()).toBe("https://example.test/api/gateway/embedding-models")
      expect(call?.[1].redirect).toBe("error")
    } finally {
      global.fetch = prev
    }
  })

  test("falls back when the request fails", async () => {
    const prev = global.fetch
    global.fetch = mock(() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch

    try {
      await expect(fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test" })).resolves.toEqual(
        BUNDLED_KILO_EMBEDDING_MODEL_CATALOG,
      )
    } finally {
      global.fetch = prev
    }
  })

  test("fallback catalog is empty so Cloud owns model metadata", () => {
    expect(EMPTY_KILO_EMBEDDING_MODEL_CATALOG).toEqual({
      defaultModel: "",
      models: [],
      aliases: {},
    })
  })

  test("bundled fallback matches public embedding model labels", () => {
    expect(BUNDLED_KILO_EMBEDDING_MODEL_CATALOG.defaultModel).toBe("mistralai/mistral-embed-2312")
    expect(BUNDLED_KILO_EMBEDDING_MODEL_CATALOG.models.map((model) => model.name)).toEqual([
      "Codestral Embed 2505",
      "Mistral Embed 2312",
      "OpenAI Text Embedding 3 Small",
      "OpenAI Text Embedding 3 Large",
      "OpenAI Text Embedding Ada 002",
      "Gemini Embedding 001",
      "Qwen3 Embedding 8B",
      "Qwen3 Embedding 4B",
      "Perplexity Embed V1 4B",
      "Perplexity Embed V1 0.6B",
      "BAAI bge-m3",
      "BAAI bge-large-en-v1.5",
      "BAAI bge-base-en-v1.5",
      "GTE Large",
      "GTE Base",
      "E5 Large v2",
      "E5 Base v2",
      "Multilingual E5 Large",
      "all-mpnet-base-v2",
      "all-MiniLM-L12-v2",
      "all-MiniLM-L6-v2",
      "paraphrase-MiniLM-L6-v2",
      "multi-qa-mpnet-base-dot-v1",
    ])
  })
})
