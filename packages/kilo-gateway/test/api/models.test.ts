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
  stubFetch(async () =>
    new Response(VALID_RESPONSE, {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  )

  const result = await fetchKiloModels({})

  ;(globalThis as any).fetch = orig

  expect(result.error).toBeUndefined()
  expect(Object.keys(result.models).length).toBeGreaterThan(0)
})

test("returns error with kind=schema when response body is invalid JSON", async () => {
  const orig = globalThis.fetch
  stubFetch(async () =>
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
