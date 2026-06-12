import { afterEach, expect, test } from "bun:test"
import { clearModesCache, fetchOrganizationModes } from "../../src/api/modes.js"

const original = globalThis.fetch

function mode(config: Record<string, unknown>) {
  return {
    id: "mode",
    organization_id: "org",
    name: "Mode",
    slug: "mode",
    created_by: "user",
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    config,
  }
}

function stub(body: unknown) {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    })
}

afterEach(() => {
  globalThis.fetch = original
  clearModesCache()
})

test("accepts omitted and null organization default models", async () => {
  stub({ modes: [mode({ roleDefinition: "first" }), mode({ roleDefinition: "second", defaultModel: null })] })

  const result = await fetchOrganizationModes("token", "org")

  expect(result).toHaveLength(2)
  expect(result[0].config.defaultModel).toBeUndefined()
  expect(result[1].config.defaultModel).toBeNull()
})

test("rejects malformed organization default models", async () => {
  stub({ modes: [mode({ roleDefinition: "first", defaultModel: 42 })] })

  expect(await fetchOrganizationModes("token", "org")).toEqual([])
})
