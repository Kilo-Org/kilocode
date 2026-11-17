import { describe, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { BrowserPolicy } from "@/kilocode/browser/policy"

const auth = (organizationID?: string) =>
  Effect.succeed(
    organizationID === undefined
      ? undefined
      : { token: Redacted.make("test-token"), organizationID },
  )

const respond = (body: unknown, status = 200): ((request: Request) => Promise<Response>) => {
  return async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

// Each case uses its own organization so the per-process cache never answers for another.
let organizations = 0
const organization = () => `org-${++organizations}`

const read = (body: unknown, status = 200) =>
  Effect.runPromise(BrowserPolicy.get({ auth: () => auth(organization()), fetch: respond(body, status) }))

describe("browser policy", () => {
  test("allow with no origins", async () => {
    expect(await read({ browserControl: "allow", browserAllowedOrigins: [] })).toEqual({
      control: "allow",
      origins: [],
    })
  })

  test("playwright_only keeps the allowlist", async () => {
    expect(
      await read({ browserControl: "playwright_only", browserAllowedOrigins: ["https://docs.example.com"] }),
    ).toEqual({ control: "playwright_only", origins: ["https://docs.example.com"] })
  })

  test("off", async () => {
    expect((await read({ browserControl: "off" }))?.control).toBe("off")
  })

  test("an unknown control value is not a policy", () => {
    expect(BrowserPolicy.parse({ browserControl: "sometimes" })).toBeUndefined()
  })

  test("extra fields from a newer cloud are ignored", () => {
    expect(BrowserPolicy.parse({ browserControl: "allow", browserAllowedOrigins: [], future: true })).toEqual({
      control: "allow",
      origins: [],
    })
  })

  test("a rejected request means no policy, not a blocked session", async () => {
    expect(await read({ error: "unauthorized" }, 401)).toBeUndefined()
    expect(await read({ error: "forbidden" }, 403)).toBeUndefined()
    expect(await read({ error: "not found" }, 404)).toBeUndefined()
  })

  test("an unreachable API means no policy", async () => {
    const policy = await Effect.runPromise(
      BrowserPolicy.get({
        auth: () => auth(organization()),
        fetch: async () => {
          throw new Error("network down")
        },
      }),
    )
    expect(policy).toBeUndefined()
  })

  test("an invalid body means no policy", async () => {
    expect(await read({ browserControl: "allow", browserAllowedOrigins: "https://x" })).toBeUndefined()
  })

  test("no signed-in organization means no request at all", async () => {
    let called = 0
    const policy = await Effect.runPromise(
      BrowserPolicy.get({
        auth: () => auth(),
        fetch: async () => {
          called++
          return new Response("{}")
        },
      }),
    )
    expect(policy).toBeUndefined()
    expect(called).toBe(0)
  })

  test("the policy is cached for the organization", async () => {
    let called = 0
    const fetch = async (request: Request) => {
      called++
      expect(request.url).toContain("/organizations/cache-org/browser-policy")
      expect(request.headers.get("Authorization")).toBe("Bearer test-token")
      return new Response(JSON.stringify({ browserControl: "off" }), { status: 200 })
    }
    const options = { auth: () => auth("cache-org"), fetch }
    const first = await Effect.runPromise(BrowserPolicy.get(options))
    const second = await Effect.runPromise(BrowserPolicy.get(options))
    expect(first?.control).toBe("off")
    expect(second?.control).toBe("off")
    expect(called).toBe(1)
  })

  test("the allowlist grants every class on the origin", () => {
    const policy = { control: "allow" as const, origins: ["https://docs.example.com"] }
    expect(BrowserPolicy.allows(policy, "https://docs.example.com")).toBe(true)
    expect(BrowserPolicy.allows(policy, "https://example.com")).toBe(false)
    expect(BrowserPolicy.allows(undefined, "https://docs.example.com")).toBe(false)
  })
})
