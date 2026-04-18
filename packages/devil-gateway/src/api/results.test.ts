import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { clearModesCache, fetchOrganizationModesResult } from "./modes.js"
import { fetchBalanceResult } from "./profile.js"

const realFetch = globalThis.fetch
const realNodeEnv = process.env.NODE_ENV
const fetchMock = mock()

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function mode() {
  return {
    id: "mode-1",
    organization_id: "org-1",
    name: "Review",
    slug: "review",
    created_by: "user-1",
    created_at: "2026-04-17T00:00:00.000Z",
    updated_at: "2026-04-17T00:00:00.000Z",
    config: {
      description: "Review changes",
    },
  }
}

describe("Devil Gateway API results", () => {
  beforeEach(() => {
    fetchMock.mockReset()
    globalThis.fetch = fetchMock as typeof fetch
    process.env.NODE_ENV = "development"
    clearModesCache()
  })

  afterEach(() => {
    globalThis.fetch = realFetch
    process.env.NODE_ENV = realNodeEnv
    clearModesCache()
  })

  test("keys organization mode cache by credential scope", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { modes: [mode()] }))
    fetchMock.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))

    const first = await fetchOrganizationModesResult("token-a", "org-1")
    const second = await fetchOrganizationModesResult("token-b", "org-1")

    expect(first).toEqual({ ok: true, modes: [mode()] })
    expect(second).toEqual({ ok: false, status: 401, error: "upstream returned 401" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  test("rejects malformed balance payloads", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { balance: "oops" }))

    const result = await fetchBalanceResult("token-1")

    expect(result).toEqual({ ok: false, error: "response validation failed" })
  })
})
