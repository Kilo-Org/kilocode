import { expect, test } from "bun:test"
import { Effect } from "effect"
import { KiloResourceToken } from "../src/index.js"

function server(respond: (request: Request) => Response) {
  const requests: { url: string; headers: Headers; body: unknown }[] = []
  const http = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ url: request.url, headers: request.headers, body: await request.json().catch(() => undefined) })
      return respond(request)
    },
  })
  return { requests, url: `http://localhost:${http.port}`, [Symbol.dispose]: () => void http.stop(true) }
}

const input = (url: string) => ({ server: url, token: "account-token", resource: "pages-dev" as const, version: "1.2.3" })

test("mints a token without an organization header", async () => {
  const expiresAt = new Date(Date.now() + 300_000).toISOString()
  using backend = server(() => Response.json({ token: "pages-token", expiresAt }))
  expect(await Effect.runPromise(KiloResourceToken.mint(input(backend.url)))).toEqual({
    token: "pages-token",
    expiresAt: Date.parse(expiresAt),
  })
  const sent = backend.requests[0]!
  expect(new URL(sent.url).pathname).toBe("/api/auth/resource-token")
  expect(sent.body).toEqual({ resource: "pages-dev" })
  expect(sent.headers.get("authorization")).toBe("Bearer account-token")
  expect(sent.headers.get("x-kilocode-organizationid")).toBeNull()
})

test("classifies refusals by status and message", () => {
  const refused = (status: number, error: string) => KiloResourceToken.classify(status, { error })
  expect(refused(401, "Unauthorized")).toEqual({ kind: "refused", reason: "needs_login", status: 401 })
  expect(refused(403, "Organization credentials are not supported")).toMatchObject({ reason: "organization_credential" })
  expect(refused(403, "Unsupported legacy credential context")).toMatchObject({ reason: "credential_type" })
  expect(refused(403, "Access denied (R0)")).toMatchObject({ reason: "blocked" })
  expect(refused(403, "something new")).toMatchObject({ reason: "blocked" })
  expect(refused(503, "Shared resource token migration is unavailable")).toMatchObject({ reason: "kilo_disabled" })
  expect(refused(400, "Unsupported resource")).toMatchObject({ reason: "server" })
  expect(refused(503, "overloaded")).toEqual({ kind: "transient", status: 503 })
  expect(KiloResourceToken.classify(429, undefined, 12)).toEqual({ kind: "transient", status: 429, retryAfter: 12 })
})

test("a failed or malformed response is a failure that never carries the body", async () => {
  using refusing = server(() => Response.json({ error: "Organization credentials are not supported" }, { status: 403 }))
  expect(await Effect.runPromise(Effect.flip(KiloResourceToken.mint(input(refusing.url))))).toEqual({
    kind: "refused",
    reason: "organization_credential",
    status: 403,
  })
  using malformed = server(() => Response.json({ token: "x", expiresAt: "not a date" }))
  expect(await Effect.runPromise(Effect.flip(KiloResourceToken.mint(input(malformed.url))))).toMatchObject({
    kind: "refused",
    reason: "server",
  })
  const offline = server(() => new Response())
  const url = offline.url
  offline[Symbol.dispose]()
  expect(await Effect.runPromise(Effect.flip(KiloResourceToken.mint(input(url))))).toEqual({ kind: "transient" })
})

test("a redirect is not followed with the bearer", async () => {
  using target = server(() => Response.json({ token: "leak", expiresAt: new Date(Date.now() + 1000).toISOString() }))
  using backend = server(() => Response.redirect(`${target.url}/api/auth/resource-token`, 307))
  expect(await Effect.runPromise(Effect.flip(KiloResourceToken.mint(input(backend.url))))).toEqual({ kind: "transient" })
  expect(target.requests).toHaveLength(0)
})
