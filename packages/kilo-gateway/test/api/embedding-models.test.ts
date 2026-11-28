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

const payload = (body: unknown) => new Response(JSON.stringify(body))

const valid = (id: string) => ({
  id,
  name: `${id} name`,
  dimension: 1024,
  scoreThreshold: 0.4,
})

describe("fetchKiloEmbeddingModelCatalog", () => {
  test("fetches catalog from Kilo Gateway", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const skip = mock(() => undefined)
    const fn = mock(() => Promise.resolve(response())) as unknown as typeof fetch
    global.fetch = fn

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({
        baseURL: "https://example.test",
        onError: issue,
        onSkip: skip,
      })

      expect(catalog.defaultModel).toBe("provider/model")
      expect(issue).not.toHaveBeenCalled()
      expect(skip).not.toHaveBeenCalled()
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

  test("keeps valid models when other entries lack a dimension", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const skip = mock(() => undefined)
    const fn = mock(() =>
      Promise.resolve(
        payload({
          defaultModel: "provider/model",
          models: [
            { id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4, note: "keep" },
            { id: "missing/one", name: "Missing One", scoreThreshold: 0.3 },
            { id: "missing/two", name: "Missing Two", scoreThreshold: 0.3 },
          ],
          aliases: { short: "provider/model" },
        }),
      ),
    )
    global.fetch = fn as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({
        baseURL: "https://example.test",
        onError: issue,
        onSkip: skip,
      })

      expect(catalog).toEqual({
        defaultModel: "provider/model",
        models: [{ id: "provider/model", name: "Provider Model", dimension: 1024, scoreThreshold: 0.4, note: "keep" }],
        aliases: { short: "provider/model" },
      })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(issue).not.toHaveBeenCalled()
      expect(skip).toHaveBeenCalledTimes(1)
      expect(skip).toHaveBeenCalledWith(2)
    } finally {
      global.fetch = prev
    }
  })

  test("keeps valid model order when entries have invalid fields", async () => {
    const prev = global.fetch
    global.fetch = mock(() =>
      Promise.resolve(
        payload({
          defaultModel: "one",
          models: [
            valid("one"),
            { id: "fractional", name: "Fractional", dimension: 12.5, scoreThreshold: 0.2 },
            { id: "zero", name: "Zero", dimension: 0, scoreThreshold: 0.2 },
            { id: "wrong-type", name: 7, dimension: 100, scoreThreshold: 0.2 },
            valid("two"),
          ],
          aliases: {},
        }),
      ),
    ) as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test" })

      expect(catalog.models.map((item) => item.id)).toEqual(["one", "two"])
    } finally {
      global.fetch = prev
    }
  })

  test("returns an empty model list when every entry is invalid", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const skip = mock(() => undefined)
    const fn = mock(() =>
      Promise.resolve(
        payload({
          defaultModel: "missing/default",
          models: [{ id: "missing/one", name: "Missing One", scoreThreshold: 0.3 }],
          aliases: { short: "missing/one" },
        }),
      ),
    )
    global.fetch = fn as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({
        baseURL: "https://example.test",
        onError: issue,
        onSkip: skip,
      })

      expect(catalog).toEqual({
        defaultModel: "missing/default",
        models: [],
        aliases: { short: "missing/one" },
      })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(skip).toHaveBeenCalledTimes(1)
      expect(skip).toHaveBeenCalledWith(1)
      expect(issue).toHaveBeenCalledTimes(1)
      expect(issue).toHaveBeenCalledWith({
        code: "invalid-response",
        message: "Kilo returned an invalid embedding model catalog.",
      })
    } finally {
      global.fetch = prev
    }
  })

  test("accepts an empty catalog without reporting an error", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const skip = mock(() => undefined)
    const fn = mock(() => Promise.resolve(payload({ defaultModel: "one", models: [], aliases: { short: "one" } })))
    global.fetch = fn as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({
        baseURL: "https://example.test",
        onError: issue,
        onSkip: skip,
      })

      expect(catalog).toEqual({ defaultModel: "one", models: [], aliases: { short: "one" } })
      expect(fn).toHaveBeenCalledTimes(1)
      expect(issue).not.toHaveBeenCalled()
      expect(skip).not.toHaveBeenCalled()
    } finally {
      global.fetch = prev
    }
  })

  test("preserves default and aliases that reference removed models", async () => {
    const prev = global.fetch
    global.fetch = mock(() =>
      Promise.resolve(
        payload({
          defaultModel: "missing/one",
          models: [valid("provider/model"), { id: "missing/one", name: "Missing One", scoreThreshold: 0.3 }],
          aliases: { short: "missing/one", good: "provider/model" },
        }),
      ),
    ) as unknown as typeof fetch

    try {
      const catalog = await fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test" })

      expect(catalog).toEqual({
        defaultModel: "missing/one",
        models: [valid("provider/model")],
        aliases: { short: "missing/one", good: "provider/model" },
      })
    } finally {
      global.fetch = prev
    }
  })

  test("rejects a non-array models field without retrying", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const fn = mock(() => Promise.resolve(payload({ defaultModel: "one", models: {}, aliases: {} })))
    global.fetch = fn as unknown as typeof fetch

    try {
      await expect(
        fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test", onError: issue }),
      ).resolves.toEqual(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(issue).toHaveBeenCalledWith({
        code: "invalid-response",
        message: "Kilo returned an invalid embedding model catalog.",
      })
    } finally {
      global.fetch = prev
    }
  })

  test("rejects malformed aliases without retrying", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const fn = mock(() =>
      Promise.resolve(payload({ defaultModel: "one", models: [valid("one")], aliases: { short: 1 } })),
    )
    global.fetch = fn as unknown as typeof fetch

    try {
      await expect(
        fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test", onError: issue }),
      ).resolves.toEqual(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(issue).toHaveBeenCalledWith({
        code: "invalid-response",
        message: "Kilo returned an invalid embedding model catalog.",
      })
    } finally {
      global.fetch = prev
    }
  })

  test("rejects invalid JSON without retrying", async () => {
    const prev = global.fetch
    const issue = mock(() => undefined)
    const fn = mock(() => Promise.resolve(new Response("{", { status: 200 })))
    global.fetch = fn as unknown as typeof fetch

    try {
      await expect(
        fetchKiloEmbeddingModelCatalog({ baseURL: "https://example.test", onError: issue }),
      ).resolves.toEqual(EMPTY_KILO_EMBEDDING_MODEL_CATALOG)
      expect(fn).toHaveBeenCalledTimes(1)
      expect(issue).toHaveBeenCalledWith({
        code: "invalid-response",
        message: "Kilo returned an invalid embedding model catalog.",
      })
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
})
