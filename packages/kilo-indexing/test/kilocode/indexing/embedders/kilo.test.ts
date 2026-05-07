import { beforeEach, describe, expect, mock, test } from "bun:test"
import { mockEmbeddingsCreate, openAIMockFactory, setOpenAIConstructorHook } from "./__helpers__/openai-mock"

mock.module("openai", openAIMockFactory)

import { KiloEmbedder, KILO_INDEXING_FEATURE } from "../../../../src/indexing/embedders/kilo"

describe("KiloEmbedder", () => {
  beforeEach(() => {
    mockEmbeddingsCreate.mockReset()
    setOpenAIConstructorHook(undefined)
  })

  test("uses Kilo Gateway headers and configured embedding model", async () => {
    const seen: unknown[] = []
    setOpenAIConstructorHook((cfg) => seen.push(cfg))
    mockEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: [0.1, 0.2] }],
      usage: { prompt_tokens: 1, total_tokens: 1 },
    })

    const embedder = new KiloEmbedder({
      apiKey: "kilo-token",
      organizationId: "org_123",
      modelId: "mistralai/mistral-embed-2312",
    })

    await embedder.createEmbeddings(["hello"])

    expect(seen[0]).toEqual({
      baseURL: "https://api.kilo.ai/api/gateway/",
      apiKey: "kilo-token",
      defaultHeaders: {
        "X-KILOCODE-FEATURE": KILO_INDEXING_FEATURE,
        "X-KILOCODE-ORGANIZATIONID": "org_123",
      },
    })
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith({
      input: ["hello"],
      model: "mistralai/mistral-embed-2312",
      encoding_format: "base64",
    })
  })

  test("normalizes custom gateway base URLs", () => {
    const seen: unknown[] = []
    setOpenAIConstructorHook((cfg) => seen.push(cfg))

    new KiloEmbedder({
      apiKey: "kilo-token",
      baseUrl: "https://example.test/api/openrouter/",
      modelId: "mistralai/mistral-embed-2312",
    })

    expect((seen[0] as { baseURL: string }).baseURL).toBe("https://example.test/api/gateway/")
  })
})
