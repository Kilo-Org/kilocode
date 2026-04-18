import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Hono } from "hono"

let server:
  | {
      requestIP: (req: Request) => { address: string; port: number; family: "IPv4" | "IPv6" } | undefined
    }
  | undefined

mock.module("hono/bun", () => ({
  getBunServer: () => server,
}))

const { rateLimit } = await import("../../src/server/rate-limit")

function makeApp() {
  const app = new Hono().use(
    rateLimit({
      limit: 1,
      windowMs: 60_000,
    }),
  )
  app.get("/x", (c) => c.text("ok"))
  return app
}

describe("rateLimit key selection", () => {
  beforeEach(() => {
    server = undefined
  })

  afterEach(() => {
    server = undefined
  })

  test("uses the trusted Bun peer address before forwarded headers", async () => {
    server = {
      requestIP() {
        return { address: "203.0.113.10", port: 4000, family: "IPv4" }
      },
    }
    const app = makeApp()

    const first = await app.request("/x", { headers: { "x-forwarded-for": "1.1.1.1" } })
    const second = await app.request("/x", { headers: { "x-forwarded-for": "8.8.8.8" } })

    expect(first.status).toBe(200)
    expect(second.status).toBe(429)
  })

  test("splits loopback clients by trusted connection metadata", async () => {
    server = {
      requestIP(req) {
        return {
          address: "127.0.0.1",
          port: Number(req.headers.get("x-port") ?? "0"),
          family: "IPv4",
        }
      },
    }
    const app = makeApp()

    const first = await app.request("/x", { headers: { "x-port": "1001" } })
    const second = await app.request("/x", { headers: { "x-port": "1002" } })

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
  })
})
