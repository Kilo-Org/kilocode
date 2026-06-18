import { describe, expect, mock, spyOn, test } from "bun:test"
import { EMPTY_KILO_EMBEDDING_MODEL_CATALOG, fetchKiloEmbeddingModelCatalog } from "../../src/api/embedding-models"

const response = () =>
  new Response(
    JSON.stringify({
      defaultModel: "provider/model",
      models: [{ id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4 }],
      aliases: { model: "provider/model" },
    }),
  )

describe("fetchKiloEmbeddingModelCatalog", () => {
  test("fetches catalog from Kilo Gateway", async () => {
    const prev = global.fetch
    const fn = mock(() => Promise.resolve(response())) as unknown as typeof fetch
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

  test("retries transient transport failures", async () => {
    const prev = global.fetch
    const fn = mock(() => Promise.reject(new TypeError("fetch failed")))
    fn.mockImplementationOnce(() => Promise.reject(new TypeError("fetch failed")))
    fn.mockImplementationOnce(() => Promise.resolve(response()))
    global.fetch = fn as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test" })

      expect(catalog.models).toHaveLength(1)
      expect(fn).toHaveBeenCalledTimes(2)
    } finally {
      global.fetch = prev
    }
  })

  test("bounds caller-controlled retry attempts", async () => {
    const prev = global.fetch
    const fn = mock(() => Promise.resolve(new Response("nope", { status: 500 })))
    global.fetch = fn as unknown as typeof fetch

    try {
      await fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test", attempts: Number.POSITIVE_INFINITY })
      expect(fn).toHaveBeenCalledTimes(3)
    } finally {
      global.fetch = prev
    }
  })

  test("reports a final failure without writing to the console", async () => {
    const prev = global.fetch
    const warn = spyOn(console, "warn").mockImplementation(() => undefined)
    const issue = mock(() => undefined)
    global.fetch = mock(() => Promise.resolve(new Response("nope", { status: 500 }))) as unknown as typeof fetch

    try {
      await expect(
        fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test", attempts: 1, onError: issue }),
      ).resolves.toEqual(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
      expect(issue).toHaveBeenCalledWith({
        code: "http",
        message: "Unable to load Kilo embedding models (HTTP 500).",
        status: 500,
      })
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
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
})
