import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloBrowserPolicy } from "../src/browser-policy"

const token = "fixture-token"
const organizationID = "org-1"
const server = "https://api.kilo.ai"

function stub(response: unknown, status = 200) {
  const calls: { url: string; headers: Record<string, string> }[] = []
  const original = globalThis.fetch
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()) })
      return new Response(JSON.stringify(response), { status, headers: { "content-type": "application/json" } })
    },
    { preconnect: () => undefined },
  ) as unknown as typeof fetch
  return {
    calls,
    restore: () => {
      globalThis.fetch = original
    },
  }
}

const get = (scope: Partial<KiloBrowserPolicy.Scope> = {}) =>
  Effect.runPromise(KiloBrowserPolicy.get({ server, token, organizationID, endpoint: server, ...scope }))

describe("organization browser policy", () => {
  test("reads the organization's policy with the Kilo token", async () => {
    const network = stub({ browserControl: "playwright_only", browserAllowedOrigins: ["https://example.com"] })
    try {
      expect(await get()).toEqual({ control: "playwright_only", origins: ["https://example.com"] })
      expect(network.calls).toHaveLength(1)
      expect(network.calls[0].url).toBe("https://api.kilo.ai/api/organizations/org-1/browser-policy")
      expect(network.calls[0].headers.authorization).toBe(`Bearer ${token}`)
    } finally {
      network.restore()
    }
  })

  test("a policy without allowed origins is an empty allowlist", async () => {
    const network = stub({ browserControl: "off" })
    try {
      expect(await get()).toEqual({ control: "off", origins: [] })
    } finally {
      network.restore()
    }
  })

  test("a personal account has no policy and makes no request", async () => {
    const network = stub([])
    try {
      expect(await get({ organizationID: null })).toBeUndefined()
      expect(network.calls).toHaveLength(0)
    } finally {
      network.restore()
    }
  })

  test("a custom or self-hosted server makes no request", async () => {
    const network = stub([])
    try {
      expect(await get({ server: "https://kilo.example.test", endpoint: "https://kilo.example.test" })).toBeUndefined()
      expect(network.calls).toHaveLength(0)
    } finally {
      network.restore()
    }
  })

  test("an error, a bad body or a failed request is no policy, never a failure", async () => {
    for (const [body, status] of [
      [{ error: "nope" }, 500],
      [{ browserControl: "sometimes" }, 200],
      [{}, 200],
    ] as const) {
      const network = stub(body, status)
      try {
        expect(await get()).toBeUndefined()
      } finally {
        network.restore()
      }
    }
    const network = stub({})
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("offline")
      },
      { preconnect: () => undefined },
    ) as unknown as typeof fetch
    try {
      expect(await get()).toBeUndefined()
    } finally {
      network.restore()
    }
  })

  test("the allowlist grants every class on an origin", () => {
    const policy: KiloBrowserPolicy.Policy = { control: "allow", origins: ["https://example.com"] }
    expect(KiloBrowserPolicy.allows(policy, "https://example.com")).toBe(true)
    expect(KiloBrowserPolicy.allows(policy, "https://other.example.com")).toBe(false)
    expect(KiloBrowserPolicy.allows(undefined, "https://example.com")).toBe(false)
  })
})
