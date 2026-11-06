import { ControlTokenError, createControlTokenCache, createControlTokenClient } from "@/kilocode/cloud/control-token"
import { expect, test } from "bun:test"
import { Redacted } from "effect"
import { createHash } from "node:crypto"

const SOURCE = "kilo-source-bearer-value"
const CONTROL = "kilo-control-token-value"
const ORG = "22222222-2222-4222-8222-222222222222"

type Recorded = { method: string; path: string; auth: string | null; org: string | null; body: string }

let now = 1_000_000
const clock = () => now

function issuer(handler?: (input: Recorded) => Response | undefined) {
  const calls: Recorded[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const recorded: Recorded = {
        method: request.method,
        path: url.pathname,
        auth: request.headers.get("authorization"),
        org: request.headers.get("x-kilocode-organizationid"),
        body: request.method === "POST" ? await request.text() : "",
      }
      calls.push(recorded)
      return (
        handler?.(recorded) ?? Response.json({ token: CONTROL, expiresAt: new Date(clock() + 600_000).toISOString() })
      )
    },
  })
  return {
    url: `http://127.0.0.1:${server.port}`,
    calls,
    stop: () => {
      void server.stop(true)
    },
  }
}

test("exchanges the source for a control token and never exposes the source in the result", async () => {
  const app = issuer()
  try {
    const tokens = createControlTokenClient({ clock })
    const control = await tokens.exchange({ source: Redacted.make(SOURCE), issuer: app.url, worker: app.url })

    expect(Redacted.value(control.token)).toBe(CONTROL)
    expect(control.expiresAt).toBe(now + 600_000)
    expect(app.calls[0]).toMatchObject({
      method: "POST",
      path: "/api/cloud-agent-next/token",
      auth: `Bearer ${SOURCE}`,
      org: null,
      body: "{}",
    })
  } finally {
    app.stop()
  }
})

test("scopes the exchange to the selected organization", async () => {
  const app = issuer()
  try {
    const tokens = createControlTokenClient({ clock })
    await tokens.exchange({ source: Redacted.make(SOURCE), organizationID: ORG, issuer: app.url, worker: app.url })
    expect(app.calls[0]).toMatchObject({ body: JSON.stringify({ organizationId: ORG }), org: ORG })
  } finally {
    app.stop()
  }
})

test("reuses one cached control token for repeat reads and re-exchanges on scope or source change", async () => {
  const app = issuer()
  try {
    const tokens = createControlTokenClient({ clock })
    const request = { source: Redacted.make(SOURCE), issuer: app.url, worker: app.url }
    await tokens.exchange(request)
    await tokens.exchange(request)
    expect(app.calls).toHaveLength(1)

    await tokens.exchange({ ...request, organizationID: ORG })
    expect(app.calls).toHaveLength(2)

    await tokens.exchange({ ...request, source: Redacted.make("rotated-source") })
    expect(app.calls).toHaveLength(3)
  } finally {
    app.stop()
  }
})

test("does not cache a token that is already within the refresh skew", async () => {
  now = 1_000_000
  const app = issuer(() => Response.json({ token: CONTROL, expiresAt: new Date(now + 30_000).toISOString() }))
  try {
    const tokens = createControlTokenClient({ clock, skewMs: 60_000 })
    const request = { source: Redacted.make(SOURCE), issuer: app.url, worker: app.url }
    await tokens.exchange(request)
    await tokens.exchange(request)
    expect(app.calls).toHaveLength(2)
  } finally {
    app.stop()
  }
})

test("reuses a cached token until shortly before expiry", async () => {
  now = 1_000_000
  const app = issuer(() => Response.json({ token: CONTROL, expiresAt: new Date(now + 120_000).toISOString() }))
  try {
    const tokens = createControlTokenClient({ clock, skewMs: 60_000 })
    const request = { source: Redacted.make(SOURCE), issuer: app.url, worker: app.url }
    await tokens.exchange(request)
    now += 50_000
    await tokens.exchange(request)
    expect(app.calls).toHaveLength(1)
  } finally {
    app.stop()
  }
})

test("normalizes issuer failures without retrying", async () => {
  for (const item of [
    { status: 401, reason: "unauthorized" },
    { status: 403, reason: "unauthorized" },
    { status: 408, reason: "unavailable" },
    { status: 429, reason: "unavailable" },
    { status: 503, reason: "unavailable" },
    { status: 500, reason: "unavailable" },
    { status: 400, reason: "invalid_response" },
    { status: 404, reason: "invalid_response" },
  ] as const) {
    const app = issuer(() => Response.json({ error: "denied" }, { status: item.status }))
    try {
      const tokens = createControlTokenClient({ clock })
      const error = await tokens
        .exchange({ source: Redacted.make(SOURCE), issuer: app.url, worker: app.url })
        .catch((value: unknown) => value)
      expect(error).toBeInstanceOf(ControlTokenError)
      expect(reasonOf(error)).toBe(item.reason)
      expect(app.calls).toHaveLength(1)
    } finally {
      app.stop()
    }
  }
})

test("rejects an invalid or already-expired token response", async () => {
  for (const body of [
    { token: "" },
    { token: CONTROL },
    { token: CONTROL, expiresAt: now + 600_000 },
    { token: CONTROL, expiresAt: new Date(now).toISOString() },
    { token: CONTROL, expiresAt: "tomorrow" },
    { other: true },
  ]) {
    const app = issuer(() => Response.json(body))
    try {
      const tokens = createControlTokenClient({ clock })
      const error = await tokens
        .exchange({ source: Redacted.make(SOURCE), issuer: app.url, worker: app.url })
        .catch((value: unknown) => value)
      expect(reasonOf(error)).toBe("invalid_response")
    } finally {
      app.stop()
    }
  }
})

test("reports transport failures as unavailable", async () => {
  const tokens = createControlTokenClient({
    clock,
    fetch: Object.assign(() => Promise.reject(new Error("offline")), { preconnect: () => undefined }),
  })
  const error = await tokens
    .exchange({ source: Redacted.make(SOURCE), issuer: "http://127.0.0.1:1", worker: "http://127.0.0.1:1" })
    .catch((value: unknown) => value)
  expect(reasonOf(error)).toBe("unavailable")
})

test("bounds the issued cache", async () => {
  const cache = createControlTokenCache(1)
  const app = issuer()
  try {
    const tokens = createControlTokenClient({ clock, cache })
    await tokens.exchange({ source: Redacted.make(SOURCE), issuer: app.url, worker: app.url })
    await tokens.exchange({ source: Redacted.make("other"), issuer: app.url, worker: app.url })
    expect(app.calls).toHaveLength(2)
    expect(cache.get(cacheKey(SOURCE, app.url))).toBeUndefined()
    expect(cache.get(cacheKey("other", app.url))).toBeDefined()
  } finally {
    app.stop()
  }
})

function cacheKey(source: string, origin: string) {
  return [createHash("sha256").update(source).digest("hex"), "", origin, origin].join(":")
}

function reasonOf(value: unknown) {
  return value instanceof ControlTokenError ? value.reason : undefined
}
