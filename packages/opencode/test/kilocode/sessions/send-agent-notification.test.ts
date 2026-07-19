import { expect, spyOn, beforeEach, afterEach } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import type { Config } from "../../../src/config/config"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import { Session } from "../../../src/session/session"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"
import { InstanceStore } from "../../../src/project/instance-store"
import { TestInstance, testInstanceStoreLayer, tmpdirScoped } from "../../fixture/fixture"

const KiloSessions = (await import("../../../src/kilo-sessions/kilo-sessions")).KiloSessions

let originalNotificationTimeout: string | undefined

beforeEach(() => {
  originalNotificationTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "50"
})

afterEach(() => {
  if (originalNotificationTimeout === undefined) {
    delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  } else {
    process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalNotificationTimeout
  }
})

const it = testEffect(CrossSpawnSpawner.defaultLayer)
const multi = testEffect(Layer.merge(CrossSpawnSpawner.defaultLayer, testInstanceStoreLayer))

function layer(overrides: Partial<Config.Interface> = {}) {
  return Layer.merge(
    KiloSessions.layer.pipe(
      Layer.provideMerge(Bus.layer),
      Layer.provide(TestConfig.layer(overrides)),
      Layer.provide(Session.defaultLayer),
    ),
    Auth.defaultLayer,
  )
}

function reset(...tokens: string[]) {
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  for (const token of tokens) clearInFlightCache(`kilo-sessions:token-valid:${token}`)
}

it.instance("dedicated immediate POST hits ingest path with an agent_notification item", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const requests: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const req = new Request(input, init)
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => {
        headers[k] = v
      })
      const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined
      requests.push({ method: req.method, path: new URL(url).pathname, body, headers })
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        return Response.json({ id: "session-1", ingestPath: "/api/session/session-1/ingest" })
      }
      if (new URL(url).pathname.endsWith("/ingest")) return new Response("{}", { status: 200 })
      return new Response("Not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    yield* Effect.promise(() => KiloSessions.bootstrap("session-1"))
    const result = yield* sessions.sendAgentNotification("session-1", {
      id: "notif-1",
      message: "Test notification",
    })

    expect(result).toEqual({ ok: true })

    const ingestPosts = requests.filter((r) => r.method === "POST" && r.path.endsWith("/ingest"))
    expect(ingestPosts).toHaveLength(1)
    const ingestReq = ingestPosts[0]
    expect(ingestReq.body).toEqual({
      data: [{ type: "agent_notification", data: { id: "notif-1", message: "Test notification" } }],
    })
    expect(ingestReq.headers["authorization"]).toBe("Bearer test-token")
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("2xx ingest response returns ok:true", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        return Response.json({ id: "session-2", ingestPath: "/api/session/session-2/ingest" })
      }
      if (new URL(url).pathname.endsWith("/ingest")) return new Response("{}", { status: 200 })
      return new Response("Not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    yield* Effect.promise(() => KiloSessions.bootstrap("session-2"))
    const result = yield* sessions.sendAgentNotification("session-2", {
      id: "notif-2",
      message: "Success test",
    })

    expect(result).toEqual({ ok: true })
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("non-2xx ingest response returns ok:false with no retry", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const requests: { method: string; path: string; body?: unknown; headers: Record<string, string> }[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const req = new Request(input, init)
      const headers: Record<string, string> = {}
      req.headers.forEach((v, k) => {
        headers[k] = v
      })
      const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined
      requests.push({ method: req.method, path: new URL(url).pathname, body, headers })
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        return Response.json({ id: "session-3", ingestPath: "/api/session/session-3/ingest" })
      }
      if (new URL(url).pathname.endsWith("/ingest")) {
        return new Response("Internal Server Error", { status: 500 })
      }
      return new Response("Not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    yield* Effect.promise(() => KiloSessions.bootstrap("session-3"))
    const result = yield* sessions.sendAgentNotification("session-3", {
      id: "notif-3",
      message: "Failure test",
    })

    expect(result).toEqual({ ok: false, reason: "http_500" })

    const ingestPosts = requests.filter((r) => r.method === "POST" && r.path.endsWith("/ingest"))
    expect(ingestPosts).toHaveLength(1)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("unauthenticated returns not_connected", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const fetch: typeof globalThis.fetch = Object.assign(
    async () => new Response("Unauthorized", { status: 401 }),
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  delete process.env.KILO_API_KEY
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    const result = yield* sessions.sendAgentNotification("session-4", {
      id: "notif-4",
      message: "No auth test",
    })

    expect(result).toEqual({ ok: false, reason: "not_connected" })
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("bounded timeout: stalled auth step returns not_connected within timeout", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/user")) {
        await new Promise(() => {})
        return new Response("{}", { status: 200 })
      }
      return new Response("Not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    const start = Date.now()
    const result = yield* sessions.sendAgentNotification("session-5", {
      id: "notif-5",
      message: "Timeout test",
    })
    const elapsed = Date.now() - start

    expect(result).toEqual({ ok: false, reason: "not_connected" })
    expect(elapsed).toBeLessThan(200)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("coalescing: sendAgentNotification awaits in-flight bootstrap for a single /api/session POST", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  let resolveSession: ((value: Response) => void) | undefined
  const sessionDeferred = new Promise<Response>((resolve) => {
    resolveSession = resolve
  })
  let sessionPostResolve: (() => void) | undefined
  const sessionPostSeen = new Promise<void>((resolve) => {
    sessionPostResolve = resolve
  })
  const requests: { method: string; path: string; body?: unknown }[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const pathname = new URL(url).pathname
      const req = new Request(input, init)
      const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined
      if (pathname === "/api/session") {
        requests.push({ method: "POST", path: pathname, body })
        sessionPostResolve?.()
        return sessionDeferred
      }
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (pathname.endsWith("/ingest")) {
        requests.push({ method: "POST", path: pathname, body })
        return new Response("{}", { status: 200 })
      }
      return new Response("Not found", { status: 404 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    const createPromise = KiloSessions.create("session-6")
    yield* Effect.promise(() => sessionPostSeen)

    // Start sendAgentNotification while the bootstrap is in flight, then
    // immediately resolve the bootstrap response so the in-flight tracker
    // completes and the notification observes the shared ingest path.
    const notifyFiber = yield* sessions.sendAgentNotification("session-6", {
      id: "notif-6",
      message: "Coalesced test",
    }).pipe(Effect.forkChild)
    resolveSession?.(Response.json({ id: "session-6", ingestPath: "/api/session/session-6/ingest" }))
    const notificationResult = yield* Fiber.join(notifyFiber)
    const createResult = yield* Effect.promise(() => createPromise)

    expect(notificationResult).toEqual({ ok: true })
    expect(createResult).toEqual({ id: "session-6", ingestPath: "/api/session/session-6/ingest" })

    const bootstrapPosts = requests.filter((r) => r.path === "/api/session")
    expect(bootstrapPosts).toHaveLength(1)

    const ingestPosts = requests.filter((r) => r.path.endsWith("/ingest"))
    const notificationPost = ingestPosts.find(
      (r) => r.body && (r.body as { data: Array<{ type: string }> }).data?.[0]?.type === "agent_notification",
    )
    expect(notificationPost).toBeDefined()
    expect(notificationPost!.body).toEqual({
      data: [{ type: "agent_notification", data: { id: "notif-6", message: "Coalesced test" } }],
    })
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})
