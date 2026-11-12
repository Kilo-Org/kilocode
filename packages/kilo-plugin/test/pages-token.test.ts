import { afterEach, expect, test } from "bun:test"
import { Effect, Redacted } from "effect"
import { PagesToken } from "../src/pages/token"

afterEach(() => PagesToken.reset())

function mint(respond: (count: number) => Response) {
  const requests: { headers: Headers; body: unknown }[] = []
  const http = Bun.serve({
    port: 0,
    async fetch(request) {
      requests.push({ headers: request.headers, body: await request.json().catch(() => undefined) })
      return respond(requests.length)
    },
  })
  const deployment = { origin: "https://pages.example.test", resource: "pages-dev" } as const
  return {
    requests,
    deployment,
    account: (token = "account-a") => ({ server: `http://localhost:${http.port}`, token }),
    [Symbol.dispose]: () => void http.stop(true),
  }
}

const valid = (count: number, seconds = 300) =>
  Response.json({ token: `pages-${count}`, expiresAt: new Date(Date.now() + seconds * 1000).toISOString() })
const get = (backend: ReturnType<typeof mint>, extra?: { rejected?: string; account?: string }) =>
  Effect.runPromise(
    PagesToken.get({
      account: backend.account(extra?.account),
      deployment: backend.deployment,
      version: "test",
      rejected: extra?.rejected,
    }).pipe(Effect.map(Redacted.value)),
  )
const fail = (backend: ReturnType<typeof mint>, extra?: { rejected?: string }) =>
  Effect.runPromise(Effect.flip(PagesToken.get({ account: backend.account(), deployment: backend.deployment, version: "test", ...extra })))

test("concurrent callers share one mint and a valid token is reused", async () => {
  using backend = mint((count) => valid(count))
  const tokens = await Promise.all(Array.from({ length: 20 }, () => get(backend)))
  expect(new Set(tokens)).toEqual(new Set(["pages-1"]))
  expect(await get(backend)).toBe("pages-1")
  expect(backend.requests).toHaveLength(1)
  expect(backend.requests[0]!.headers.get("x-kilocode-organizationid")).toBeNull()
  expect(backend.requests[0]!.body).toEqual({ resource: "pages-dev" })
  expect(PagesToken.peek(backend.account(), backend.deployment).kind).toBe("valid")
})

test("a token that is within the skew of its expiry is replaced", async () => {
  using backend = mint((count) => valid(count, 30))
  expect(await get(backend)).toBe("pages-1")
  expect(await get(backend)).toBe("pages-2")
})

test("each credential has its own token and drop forgets one", async () => {
  using backend = mint((count) => valid(count))
  expect(await get(backend)).toBe("pages-1")
  expect(await get(backend, { account: "account-b" })).toBe("pages-2")
  expect(await get(backend)).toBe("pages-1")
  PagesToken.drop(backend.account(), backend.deployment)
  expect(await get(backend)).toBe("pages-3")
})

test("a rejected token forces one re-mint per window, then needs a new sign-in", async () => {
  using backend = mint((count) => valid(count))
  expect(await get(backend)).toBe("pages-1")
  expect(await get(backend, { rejected: "pages-1" })).toBe("pages-2")
  // A token that is no longer the cached one does not force anything.
  expect(await get(backend, { rejected: "pages-1" })).toBe("pages-2")
  expect(await fail(backend, { rejected: "pages-2" })).toEqual({ kind: "refused", reason: "needs_login", status: 401 })
  expect(backend.requests).toHaveLength(2)
})

test("a refusal is cached and a user retry asks Kilo again", async () => {
  using backend = mint((count) =>
    count === 1 ? Response.json({ error: "Organization credentials are not supported" }, { status: 403 }) : valid(count),
  )
  expect(await fail(backend)).toMatchObject({ kind: "refused", reason: "organization_credential" })
  expect(await fail(backend)).toMatchObject({ kind: "refused", reason: "organization_credential" })
  expect(backend.requests).toHaveLength(1)
  expect(PagesToken.peek(backend.account(), backend.deployment).kind).toBe("refused")
  PagesToken.retry(backend.account(), backend.deployment)
  expect(await get(backend)).toBe("pages-2")
})

test("a transient failure backs off without asking Kilo again", async () => {
  using backend = mint(() => new Response("down", { status: 503 }))
  expect(await fail(backend)).toEqual({ kind: "transient", status: 503 })
  expect(await fail(backend)).toEqual({ kind: "transient", status: 503 })
  expect(backend.requests).toHaveLength(1)
  const entry = PagesToken.peek(backend.account(), backend.deployment)
  expect(entry.kind).toBe("backoff")
  if (entry.kind === "backoff") expect(entry.retryAt - Date.now()).toBeGreaterThan(25_000)
})
