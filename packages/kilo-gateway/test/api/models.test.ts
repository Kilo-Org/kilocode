// Verifies fetchKiloModels typed result and 401 fallback behaviour.

import { test, expect } from "bun:test"
import { fetchKiloModels } from "../../src/api/models.js"

const VALID_RESPONSE = JSON.stringify({
  data: [
    {
      id: "test/model-a",
      name: "Test Model A",
      context_length: 128000,
      max_completion_tokens: 16384,
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "temperature"],
      isFree: false,
      mayTrainOnYourPrompts: true,
      hasUserByokAvailable: true,
    },
  ],
})

const VALID_BENCH_RESPONSE = JSON.stringify({
  data: [
    {
      id: "test/model-a",
      name: "Test Model A",
      context_length: 128000,
      max_completion_tokens: 16384,
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "temperature"],
      terminalBench: {
        overallScore: 0.551,
        avgAttemptCostUsd: 53.37,
      },
    },
  ],
})

const VALID_AUTO_ROUTING_RESPONSE = JSON.stringify({
  data: [
    {
      id: "kilo-auto/efficient",
      name: "Kilo Auto Efficient",
      context_length: 128000,
      max_completion_tokens: 16384,
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "temperature"],
      autoRouting: {
        models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
      },
    },
  ],
})

const ORG_AUTO_ROUTING_MISSING_RESPONSE = JSON.stringify({
  data: [
    {
      id: "kilo-auto/efficient",
      name: "Org Kilo Auto Efficient",
      context_length: 64000,
      max_completion_tokens: 8192,
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "temperature"],
      isFree: true,
    },
  ],
})

const INVALID_BENCH_RESPONSE = JSON.stringify({
  data: [
    {
      id: "test/model-a",
      name: "Test Model A",
      context_length: 128000,
      max_completion_tokens: 16384,
      architecture: {
        input_modalities: ["text"],
        output_modalities: ["text"],
      },
      supported_parameters: ["tools", "temperature"],
      terminalBench: {
        overallScore: 0.551,
      },
    },
  ],
})

function stubFetch(fn: (input: string | URL | Request, init?: RequestInit) => Promise<Response>) {
  ;(globalThis as any).fetch = fn
}

test("returns empty models and error when both auth and public requests return 401", async () => {
  const orig = globalThis.fetch
  stubFetch(async () => new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }))

  const result = await fetchKiloModels({ kilocodeToken: "bad-token" })

  ;(globalThis as any).fetch = orig

  expect(result.models).toEqual({})
  expect(result.error).toBeDefined()
})

test("falls back to public endpoint on 401 and returns models", async () => {
  const orig = globalThis.fetch
  let callCount = 0

  stubFetch(async () => {
    callCount++
    if (callCount === 1) {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })
    }
    return new Response(VALID_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })

  const result = await fetchKiloModels({
    kilocodeToken: "expired-token",
    kilocodeOrganizationId: "org-123",
  })

  ;(globalThis as any).fetch = orig

  expect(callCount).toBe(2)
  expect(result.error).toBeUndefined()
  expect(Object.keys(result.models).length).toBeGreaterThan(0)
})

test("returns error with kind=network on fetch exception", async () => {
  const orig = globalThis.fetch
  stubFetch(async () => {
    throw new Error("network error")
  })

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.models).toEqual({})
  expect(result.error?.kind).toBe("network")
})

test("returns error with kind=http on non-auth HTTP error (e.g. 500)", async () => {
  const orig = globalThis.fetch
  stubFetch(async () => new Response("Server Error", { status: 500, statusText: "Internal Server Error" }))

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.models).toEqual({})
  expect(result.error?.kind).toBe("http")
  expect(result.error?.status).toBe(500)
})

test("returns models without error on success", async () => {
  const orig = globalThis.fetch
  stubFetch(
    async () =>
      new Response(VALID_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.error).toBeUndefined()
  expect(result.models["test/model-a"]).toMatchObject({
    isFree: false,
    mayTrainOnYourPrompts: true,
    hasUserByokAvailable: true,
  })
})

test("preserves Terminal Bench metadata as a dedicated model field", async () => {
  const orig = globalThis.fetch
  stubFetch(
    async () =>
      new Response(VALID_BENCH_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.error).toBeUndefined()
  expect(result.models["test/model-a"].terminalBench).toEqual({
    overallScore: 0.551,
    avgAttemptCostUsd: 53.37,
  })
})

test("preserves Auto Efficient routing metadata as a dedicated model field", async () => {
  const orig = globalThis.fetch
  stubFetch(
    async () =>
      new Response(VALID_AUTO_ROUTING_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.error).toBeUndefined()
  expect(result.models["kilo-auto/efficient"].autoRouting).toEqual({
    models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
  })
})

test("merges missing Auto Efficient routing metadata into organization catalog from public catalog", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []

  stubFetch(async (input) => {
    urls.push(String(input))

    if (urls.length === 1) {
      return new Response(ORG_AUTO_ROUTING_MISSING_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(VALID_AUTO_ROUTING_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })

  const result = await fetchKiloModels({
    kilocodeOrganizationId: "org-123",
  })

  ;(globalThis as any).fetch = orig

  expect(urls).toHaveLength(2)
  expect(urls[0]).toContain("/api/organizations/org-123/models")
  expect(urls[1]).toContain("/api/openrouter/models")
  expect(result.error).toBeUndefined()
  expect(result.models["kilo-auto/efficient"]).toMatchObject({
    name: "Org Kilo Auto Efficient",
    isFree: true,
    limit: {
      context: 64000,
      output: 8192,
    },
    autoRouting: {
      models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
    },
  })
})

test("merges Auto Efficient routing metadata from configured public catalog endpoint", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []

  stubFetch(async (input) => {
    urls.push(String(input))

    if (urls.length === 1) {
      return new Response(ORG_AUTO_ROUTING_MISSING_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(VALID_AUTO_ROUTING_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })

  const result = await fetchKiloModels({
    kilocodeOrganizationId: "org-123",
    baseURL: "https://dev.test/api/organizations/org-123",
  })

  ;(globalThis as any).fetch = orig

  expect(urls).toEqual([
    "https://dev.test/api/organizations/org-123/models",
    "https://dev.test/api/openrouter/models",
  ])
  expect(result.error).toBeUndefined()
  expect(result.models["kilo-auto/efficient"].autoRouting).toEqual({
    models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
  })
})

test("merges Auto Efficient routing metadata from token-derived public catalog endpoint", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []

  stubFetch(async (input) => {
    urls.push(String(input))

    if (urls.length === 1) {
      return new Response(ORG_AUTO_ROUTING_MISSING_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(VALID_AUTO_ROUTING_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })

  const result = await fetchKiloModels({
    kilocodeToken: "https://token.test/dev:opaque",
    kilocodeOrganizationId: "org-123",
  })

  ;(globalThis as any).fetch = orig

  expect(urls).toEqual(["https://token.test/dev/models", "https://token.test/dev/api/openrouter/models"])
  expect(result.error).toBeUndefined()
  expect(result.models["kilo-auto/efficient"].autoRouting).toEqual({
    models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
  })
})

test("caches Auto Efficient routing metadata by configured public catalog endpoint", async () => {
  const orig = globalThis.fetch
  const urls: string[] = []

  stubFetch(async (input) => {
    const url = String(input)
    urls.push(url)

    if (url.includes("/api/openrouter/")) {
      return new Response(VALID_AUTO_ROUTING_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }

    return new Response(ORG_AUTO_ROUTING_MISSING_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    })
  })

  const opts = {
    kilocodeOrganizationId: "org-cache",
    baseURL: "https://cache.test/api/organizations/org-cache",
  }
  const first = await fetchKiloModels(opts)
  const second = await fetchKiloModels(opts)

  ;(globalThis as any).fetch = orig

  expect(urls).toEqual([
    "https://cache.test/api/organizations/org-cache/models",
    "https://cache.test/api/openrouter/models",
    "https://cache.test/api/organizations/org-cache/models",
  ])
  expect(first.models["kilo-auto/efficient"].autoRouting).toEqual({
    models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
  })
  expect(second.models["kilo-auto/efficient"].autoRouting).toEqual({
    models: ["google/gemini-2.5-flash", "anthropic/claude-sonnet-4.6"],
  })
})

test("omits malformed Terminal Bench metadata without rejecting the catalog", async () => {
  const orig = globalThis.fetch
  stubFetch(
    async () =>
      new Response(INVALID_BENCH_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.error).toBeUndefined()
  expect(result.models["test/model-a"].terminalBench).toBeUndefined()
})

test("returns error with kind=schema when response body is invalid JSON", async () => {
  const orig = globalThis.fetch
  stubFetch(
    async () =>
      new Response("not valid json{{{{", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.models).toEqual({})
  expect(result.error?.kind).toBe("schema")
})
