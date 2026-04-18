// devilcode_change - audit C7
import { describe, expect, test } from "bun:test"
import { Hono } from "hono"
import { basicAuth } from "hono/basic-auth"
import { rateLimit, type RateLimitOptions } from "../../src/server/rate-limit"

function makeApp(opts: Partial<RateLimitOptions>) {
  let t = 0
  const app = new Hono().use(
    rateLimit({
      limit: opts.limit ?? 3,
      windowMs: opts.windowMs ?? 60_000,
      keyGenerator: (c) => c.req.header("x-test-key") ?? "anon",
      onRejected: opts.onRejected,
      shouldApply: opts.shouldApply,
      now: opts.now ?? (() => t),
    }),
  )
  app.get("/x", (c) => c.text("ok"))
  return {
    app,
    advance(ms: number) {
      t += ms
    },
  }
}

describe("rateLimit middleware", () => {
  test("allows requests under limit", async () => {
    const { app } = makeApp({ limit: 3 })
    for (let i = 0; i < 3; i++) {
      const res = await app.request("/x", { headers: { "x-test-key": "k1" } })
      expect(res.status).toBe(200)
      expect(res.headers.get("RateLimit-Limit")).toBe("3")
    }
  })

  test("returns 429 once limit exceeded", async () => {
    const { app } = makeApp({ limit: 2 })
    await app.request("/x", { headers: { "x-test-key": "k1" } })
    await app.request("/x", { headers: { "x-test-key": "k1" } })
    const res = await app.request("/x", { headers: { "x-test-key": "k1" } })
    expect(res.status).toBe(429)
    expect(res.headers.get("Retry-After")).not.toBeNull()
    const body = await res.json()
    expect(body).toEqual({ error: "Too Many Requests" })
  })

  test("buckets are per-key", async () => {
    const { app } = makeApp({ limit: 1 })
    const a = await app.request("/x", { headers: { "x-test-key": "a" } })
    const b = await app.request("/x", { headers: { "x-test-key": "b" } })
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
  })

  test("window resets after windowMs", async () => {
    let now = 1_000
    const { app } = makeApp({
      limit: 1,
      windowMs: 5_000,
      now: () => now,
    })
    const r1 = await app.request("/x", { headers: { "x-test-key": "k" } })
    expect(r1.status).toBe(200)
    const r2 = await app.request("/x", { headers: { "x-test-key": "k" } })
    expect(r2.status).toBe(429)
    now += 6_000
    const r3 = await app.request("/x", { headers: { "x-test-key": "k" } })
    expect(r3.status).toBe(200)
  })

  test("preserves custom rejection headers on 429 responses", async () => {
    const { app } = makeApp({
      limit: 1,
      onRejected(_c, res) {
        res.headers.set("Access-Control-Allow-Origin", "http://localhost:3000")
      },
    })
    await app.request("/x", { headers: { "x-test-key": "k1", origin: "http://localhost:3000" } })
    const res = await app.request("/x", { headers: { "x-test-key": "k1", origin: "http://localhost:3000" } })

    expect(res.status).toBe(429)
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:3000")
  })

  test("throttles repeated failed basic-auth attempts when limiter runs first", async () => {
    const app = new Hono()
      .use(
        rateLimit({
          limit: 1,
          windowMs: 60_000,
          keyGenerator: () => "auth",
        }),
      )
      .use((c, next) => basicAuth({ username: "kilo", password: "secret" })(c, next))
    app.get("/x", (c) => c.text("ok"))

    const first = await app.request("/x")
    const second = await app.request("/x")

    expect(first.status).toBe(401)
    expect(second.status).toBe(429)
  })
})
