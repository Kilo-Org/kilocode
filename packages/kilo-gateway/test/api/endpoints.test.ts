// Verifies fetchKiloModelEndpoints parsing, slug resolution, catalog selection and public-API fallback.

import { test, expect, afterEach } from "bun:test"
import { fetchKiloModelEndpoints } from "../../src/api/endpoints.js"

const VALID_RESPONSE = JSON.stringify({
  data: {
    id: "test/model",
    endpoints: [
      {
        name: "GMICloud | test/model",
        tag: "gmicloud/fp8",
        provider_name: "GMICloud",
        quantization: "fp8",
        context_length: 202752,
        max_completion_tokens: 202752,
        pricing: { prompt: "0.0000005", completion: "0.00000175" },
        uptime_last_30m: 99.5,
      },
      {
        name: "Chutes | test/model",
        provider_name: "Chutes",
        quantization: "int4",
        context_length: 80000,
        pricing: { prompt: "0.0000003", completion: "0.000001" },
      },
      {
        // No tag and no provider_name — cannot be routed to, must be dropped
        name: "Anonymous | test/model",
        context_length: 32000,
      },
    ],
  },
})

const orig = globalThis.fetch

afterEach(() => {
  globalThis.fetch = orig
})

function stubFetch(fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  globalThis.fetch = fn as typeof fetch
}

function json(body: string) {
  return new Response(body, { status: 200, headers: { "content-type": "application/json" } })
}

test("parses endpoints, prefers tag as routing slug, drops unroutable entries", async () => {
  stubFetch(async () => json(VALID_RESPONSE))

  const result = await fetchKiloModelEndpoints("test/model", { kilocodeToken: "token" })

  expect(result.error).toBeUndefined()
  expect(result.endpoints).toHaveLength(2)

  const first = result.endpoints[0]
  expect(first.provider).toBe("gmicloud/fp8")
  expect(first.name).toBe("GMICloud")
  expect(first.quantization).toBe("fp8")
  expect(first.context).toBe(202752)
  expect(first.pricing?.input).toBeCloseTo(0.5)
  expect(first.pricing?.output).toBeCloseTo(1.75)
  expect(first.uptime).toBe(99.5)

  // provider_name is the fallback slug when tag is missing
  expect(result.endpoints[1].provider).toBe("Chutes")
})

test("falls back to the public OpenRouter API when the gateway does not serve endpoints", async () => {
  const urls: string[] = []

  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input.toString()
    urls.push(url)
    if (urls.length === 1) return new Response("Not Found", { status: 404, statusText: "Not Found" })
    return json(VALID_RESPONSE)
  })

  const result = await fetchKiloModelEndpoints("test/model", { kilocodeToken: "token" })

  expect(urls).toHaveLength(2)
  expect(urls[1].startsWith("https://openrouter.ai/api/v1/models/test/model/endpoints")).toBe(true)
  expect(result.error).toBeUndefined()
  expect(result.endpoints).toHaveLength(2)
})

test("public catalog queries the public OpenRouter API only and sends no auth", async () => {
  const requests: { url: string; auth: string | undefined }[] = []

  stubFetch(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString()
    requests.push({ url, auth: new Headers(init?.headers).get("authorization") ?? undefined })
    return json(VALID_RESPONSE)
  })

  const result = await fetchKiloModelEndpoints("test/model", { kilocodeToken: "token", catalog: "public" })

  expect(requests).toHaveLength(1)
  expect(requests[0].url.startsWith("https://openrouter.ai/api/v1/models/test/model/endpoints")).toBe(true)
  expect(requests[0].auth).toBeUndefined()
  expect(result.error).toBeUndefined()
  expect(result.endpoints).toHaveLength(2)
})

test("encodes model path segments while preserving the author/model slash", async () => {
  const urls: string[] = []

  stubFetch(async (input) => {
    const url = input instanceof Request ? input.url : input.toString()
    urls.push(url)
    return json(VALID_RESPONSE)
  })

  await fetchKiloModelEndpoints("test/mo del?x#y", { catalog: "public" })

  expect(urls[0].endsWith("/models/test/mo%20del%3Fx%23y/endpoints")).toBe(true)
})

test("rejects model IDs with traversal or empty segments without fetching", async () => {
  let calls = 0
  stubFetch(async () => {
    calls++
    return json(VALID_RESPONSE)
  })

  for (const model of ["../organizations/x", "test/..", "./test", "test//model", ""]) {
    const result = await fetchKiloModelEndpoints(model, { catalog: "public" })
    expect(result.endpoints).toEqual([])
    expect(result.error?.kind).toBe("invalid")
  }
  expect(calls).toBe(0)
})

test("does not retry the public API on schema errors and reports them", async () => {
  let calls = 0
  stubFetch(async () => {
    calls++
    return json(JSON.stringify({ unexpected: true }))
  })

  const result = await fetchKiloModelEndpoints("test/model", {})

  expect(calls).toBe(1)
  expect(result.endpoints).toEqual([])
  expect(result.error?.kind).toBe("schema")
})

test("returns error when both gateway and public API fail", async () => {
  stubFetch(async () => {
    throw new Error("network down")
  })

  const result = await fetchKiloModelEndpoints("test/model", {})

  expect(result.endpoints).toEqual([])
  expect(result.error?.kind).toBe("network")
})

test("tolerates null endpoint fields and drops only malformed entries", async () => {
  const body = JSON.stringify({
    data: {
      id: "test/model",
      endpoints: [
        {
          name: "GMICloud | test/model",
          tag: "gmicloud/fp8",
          provider_name: "GMICloud",
          quantization: null,
          context_length: null,
          pricing: null,
          uptime_last_30m: null,
        },
        {
          name: "Chutes | test/model",
          tag: null,
          provider_name: "Chutes",
          pricing: { prompt: null, completion: "0.000001", input_cache_read: null },
        },
        // Malformed entry — must not fail the surrounding catalog
        { name: null, tag: "broken/fp8" },
      ],
    },
  })
  stubFetch(async () => json(body))

  const result = await fetchKiloModelEndpoints("test/model", { catalog: "public" })

  expect(result.error).toBeUndefined()
  expect(result.endpoints).toHaveLength(2)
  expect(result.endpoints[0].provider).toBe("gmicloud/fp8")
  expect(result.endpoints[0].pricing).toBeUndefined()
  expect(result.endpoints[0].quantization).toBeUndefined()
  expect(result.endpoints[1].provider).toBe("Chutes")
  expect(result.endpoints[1].pricing?.output).toBeCloseTo(1)
  expect(result.endpoints[1].pricing?.input).toBeUndefined()
})

test("accepts responses without the unused data.id field", async () => {
  stubFetch(async () => json(JSON.stringify({ data: { endpoints: [{ name: "X | test/model", tag: "x/fp8" }] } })))

  const result = await fetchKiloModelEndpoints("test/model", { catalog: "public" })

  expect(result.error).toBeUndefined()
  expect(result.endpoints).toHaveLength(1)
  expect(result.endpoints[0].provider).toBe("x/fp8")
})

test("keeps cache-only pricing", async () => {
  const body = JSON.stringify({
    data: {
      id: "test/model",
      endpoints: [
        {
          name: "Cachey | test/model",
          tag: "cachey/fp8",
          pricing: { input_cache_read: "0.0000001", input_cache_write: "0.0000002" },
        },
      ],
    },
  })
  stubFetch(async () => json(body))

  const result = await fetchKiloModelEndpoints("test/model", { catalog: "public" })

  expect(result.endpoints).toHaveLength(1)
  expect(result.endpoints[0].pricing?.cacheRead).toBeCloseTo(0.1)
  expect(result.endpoints[0].pricing?.cacheWrite).toBeCloseTo(0.2)
})
