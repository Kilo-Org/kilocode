import { afterEach, beforeEach, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import { GlobalBus } from "../../../src/bus/global"
import type { Config } from "../../../src/config/config"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import {
  consumeAutoTitle,
  consumeRenameAdoption,
  markAutoTitle,
  markRenameAdopted,
} from "../../../src/kilo-sessions/rename-adoptions"
import { Session } from "../../../src/session/session"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"
import { TestInstance } from "../../fixture/fixture"

const KiloSessions = (await import("../../../src/kilo-sessions/kilo-sessions")).KiloSessions

// Session must be provideMerged so yield* Session.Service and the
// KiloSessions Updated handler share one store (otherwise get() misses creates).
const it = testEffect(Layer.mergeAll(CrossSpawnSpawner.defaultLayer, Auth.defaultLayer))

function layer(overrides: Partial<Config.Interface> = {}) {
  return KiloSessions.layer.pipe(
    Layer.provideMerge(Bus.layer),
    Layer.provideMerge(Session.defaultLayer),
    Layer.provide(TestConfig.layer(overrides)),
  )
}

function reset(...tokens: string[]) {
  clearInFlightCache("kilo-sessions:token")
  clearInFlightCache("kilo-sessions:client")
  clearInFlightCache("kilo-sessions:org")
  for (const token of tokens) clearInFlightCache(`kilo-sessions:token-valid:${token}`)
}

const ORG_META = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee"
const ORG_ENV = "11111111-2222-4333-8444-555555555555"
const ORG_AUTH = "99999999-8888-4777-8666-555555555555"

beforeEach(() => {
  delete process.env.KILO_ORG_ID
})

afterEach(() => {
  delete process.env.KILO_ORG_ID
})

type Req = { method: string; path: string; body?: any }

function titlePosts(requests: Req[]) {
  return requests.filter((r) => r.method === "POST" && r.path.endsWith("/title"))
}

function metaItems(requests: Req[]) {
  const items: any[] = []
  for (const r of requests) {
    if (r.method !== "POST") continue
    const data = r.body?.data
    if (!Array.isArray(data)) continue
    for (const item of data) {
      if (item?.type === "kilo_meta") items.push(item.data)
    }
  }
  return items
}

function mockFetch(requests: Req[]) {
  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      const req = new Request(input, init)
      const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined
      requests.push({ method: req.method, path: new URL(url).pathname, body })
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        const id = "remote-" + requests.length
        return Response.json({ id, ingestPath: `/api/session/${id}/ingest` })
      }
      if (new URL(url).pathname.endsWith("/ingest")) return new Response("{}", { status: 200 })
      if (new URL(url).pathname.endsWith("/title")) return Response.json({ title: "ok", applied: true })
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  ) as typeof globalThis.fetch
}

function emitUpdated(directory: string, sessionID: string, title: string) {
  GlobalBus.emit("event", {
    directory,
    payload: {
      id: `evt-${Date.now()}-${Math.random()}`,
      type: Session.Event.Updated.type,
      properties: { sessionID, info: { title } },
    },
  })
}

// Ingest queue debounces ~1s; wait past that and drain.
const settle = Effect.gen(function* () {
  yield* Effect.sleep(1200)
  yield* Effect.promise(() => KiloSessions.drainIngestForShutdown())
})

it.instance("meta org precedence: session metadata > KILO_ORG_ID > auth accountId", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const requests: Req[] = []
  const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_ORG_ID = ORG_ENV
  reset("test-token")

  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    const instance = yield* TestInstance
    yield* auth.set("kilo", {
      type: "oauth",
      access: "x",
      refresh: "y",
      expires: Date.now() + 60_000,
      accountId: ORG_AUTH,
    })
    yield* kilo.init()
    yield* Effect.sleep(30)

    // 1) metadata wins over env
    const withMeta = yield* sessions.create({ metadata: { orgId: ORG_META } })
    yield* Effect.promise(() => KiloSessions.bootstrap(withMeta.id))
    requests.length = 0
    emitUpdated(instance.directory, withMeta.id, withMeta.title)
    yield* settle
    expect(metaItems(requests).some((m) => m.orgId === ORG_META)).toBe(true)

    // 2) env wins when metadata absent
    requests.length = 0
    const plain = yield* sessions.create({})
    yield* Effect.promise(() => KiloSessions.bootstrap(plain.id))
    requests.length = 0
    emitUpdated(instance.directory, plain.id, plain.title)
    yield* settle
    expect(metaItems(requests).some((m) => m.orgId === ORG_ENV)).toBe(true)

    // 3) auth accountId when env cleared
    delete process.env.KILO_ORG_ID
    clearInFlightCache("kilo-sessions:org")
    requests.length = 0
    const authOnly = yield* sessions.create({})
    yield* Effect.promise(() => KiloSessions.bootstrap(authOnly.id))
    requests.length = 0
    emitUpdated(instance.directory, authOnly.id, authOnly.title)
    yield* settle
    expect(metaItems(requests).some((m) => m.orgId === ORG_AUTH)).toBe(true)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        delete process.env.KILO_ORG_ID
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("meta falls through invalid metadata orgId to env", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const requests: Req[] = []
  const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_ORG_ID = ORG_ENV
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    const instance = yield* TestInstance
    yield* kilo.init()
    yield* Effect.sleep(30)

    const bad = yield* sessions.create({ metadata: { orgId: "not-a-uuid" } })
    yield* Effect.promise(() => KiloSessions.bootstrap(bad.id))
    requests.length = 0
    emitUpdated(instance.directory, bad.id, bad.title)
    yield* settle
    expect(metaItems(requests).some((m) => m.orgId === ORG_ENV)).toBe(true)
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        delete process.env.KILO_ORG_ID
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("meta falls back to env when Session.Service.get fails", () => {
  const originalKey = process.env.KILO_API_KEY
  process.env.KILO_ORG_ID = ORG_ENV
  clearInFlightCache("kilo-sessions:org")

  return Effect.gen(function* () {
    // No preloaded info + unknown session id → resolveSessionOrg get fails → env.
    const result = yield* Effect.promise(() =>
      KiloSessions._metaForTests("ses_missing_for_meta_get_fail"),
    )
    expect(result.orgId).toBe(ORG_ENV)
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        delete process.env.KILO_ORG_ID
        clearInFlightCache("kilo-sessions:org")
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("title broadcast: auto-title posts generated true; custom posts generated false; adoption skips", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const originalTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  const requests: Req[] = []
  const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "5000"
  reset("test-token")

  return Effect.gen(function* () {
    const instance = yield* TestInstance
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    yield* kilo.init()
    yield* Effect.sleep(30)

    const created = yield* sessions.create({})
    const id = created.id
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    const defaultTitle = created.title
    expect(Session.isDefaultTitle(defaultTitle)).toBe(true)

    // Created seeds knownTitles; same-title Updated is a no-op POST-wise.
    emitUpdated(instance.directory, id, defaultTitle)
    yield* Effect.sleep(50)
    expect(titlePosts(requests)).toHaveLength(0)

    // Auto-title: mark then setTitle so Updated consumer sees generated:true.
    const auto = "Auto generated title"
    markAutoTitle(id, auto)
    yield* sessions.setTitle({ sessionID: id, title: auto })
    yield* Effect.sleep(300)
    {
      const posts = titlePosts(requests)
      expect(posts.length).toBeGreaterThanOrEqual(1)
      expect(posts[posts.length - 1].body).toEqual({ title: auto, generated: true })
      expect(posts[posts.length - 1].path).toBe(`/api/session/${id}/title`)
    }
    expect(consumeAutoTitle(id, auto)).toBe(false)

    requests.length = 0
    yield* sessions.setTitle({ sessionID: id, title: "Custom A" })
    yield* Effect.sleep(300)
    {
      const posts = titlePosts(requests)
      expect(posts.length).toBeGreaterThanOrEqual(1)
      expect(posts[posts.length - 1].body).toEqual({ title: "Custom A", generated: false })
    }

    requests.length = 0
    yield* sessions.setTitle({ sessionID: id, title: "Custom B" })
    yield* Effect.sleep(300)
    {
      const posts = titlePosts(requests)
      expect(posts.length).toBeGreaterThanOrEqual(1)
      expect(posts[posts.length - 1].body).toEqual({ title: "Custom B", generated: false })
    }

    requests.length = 0
    markRenameAdopted(id, "From cloud")
    yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
    yield* Effect.sleep(300)
    expect(titlePosts(requests)).toHaveLength(0)
    expect(consumeRenameAdoption(id, "From cloud")).toBe(false)
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        if (originalTimeout === undefined) delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
        else process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalTimeout
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance(
  "title broadcast: same-title Updated consumes rename adoption (double session.renamed)",
  () => {
    const originalKey = process.env.KILO_API_KEY
    const originalIngest = process.env.KILO_SESSION_INGEST_URL
    const originalTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
    const requests: Req[] = []
    const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

    process.env.KILO_API_KEY = "test-token"
    process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
    process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "5000"
    reset("test-token")

    return Effect.gen(function* () {
      const kilo = yield* KiloSessions.Service
      const sessions = yield* Session.Service
      yield* kilo.init()
      yield* Effect.sleep(30)

      const created = yield* sessions.create({})
      const id = created.id
      yield* Effect.promise(() => KiloSessions.bootstrap(id))
      yield* Effect.sleep(50)
      requests.length = 0

      // Cloud rename applied once: marks adoption + setTitle → Updated consumes mark, no POST.
      markRenameAdopted(id, "From cloud")
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      yield* Effect.sleep(300)
      expect(titlePosts(requests)).toHaveLength(0)
      expect(consumeRenameAdoption(id, "From cloud")).toBe(false)

      // C2 re-emits session.renamed (or setTitle same title): mark again, same-title Updated
      // must still consume so a later real local rename is not swallowed.
      markRenameAdopted(id, "From cloud")
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      yield* Effect.sleep(300)
      expect(titlePosts(requests)).toHaveLength(0)
      expect(consumeRenameAdoption(id, "From cloud")).toBe(false)

      // Later local rename to the same title must POST (Decision 8 last-write-wins).
      requests.length = 0
      yield* sessions.setTitle({ sessionID: id, title: "Local rename away" })
      yield* Effect.sleep(300)
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      yield* Effect.sleep(300)
      const posts = titlePosts(requests)
      expect(posts.some((p) => p.body?.title === "From cloud" && p.body?.generated === false)).toBe(true)
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (originalKey === undefined) delete process.env.KILO_API_KEY
          else process.env.KILO_API_KEY = originalKey
          if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
          else process.env.KILO_SESSION_INGEST_URL = originalIngest
          if (originalTimeout === undefined) delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
          else process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalTimeout
          reset("test-token")
          request.mockRestore()
        }),
      ),
      Effect.provide(layer()),
    )
  },
  15_000,
)

it.instance("title broadcast: first rename after create (rename-before-prompt) POSTs", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const originalTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  const requests: Req[] = []
  const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "5000"
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    yield* kilo.init()
    yield* Effect.sleep(30)

    // create publishes Created (seeds knownTitles) then we rename before any prompt/Updated seed.
    const created = yield* sessions.create({})
    const id = created.id
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    yield* sessions.setTitle({ sessionID: id, title: "Renamed before prompt" })
    yield* Effect.sleep(300)
    const posts = titlePosts(requests)
    expect(posts.length).toBeGreaterThanOrEqual(1)
    expect(posts[posts.length - 1].body).toEqual({ title: "Renamed before prompt", generated: false })
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        if (originalTimeout === undefined) delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
        else process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalTimeout
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("title broadcast: first rename after restart seeds from list and POSTs", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const originalTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  const requests: Req[] = []
  const request = spyOn(globalThis, "fetch").mockImplementation(mockFetch(requests))

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "5000"
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    // Pre-existing session (process restart: no Created in this process).
    const existing = yield* sessions.create({})
    const id = existing.id
    const priorTitle = existing.title

    // Fresh KiloSessions init seeds knownTitles from sessions.list().
    const kilo = yield* KiloSessions.Service
    yield* kilo.init()
    yield* Effect.sleep(30)
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    yield* sessions.setTitle({ sessionID: id, title: "First rename after restart" })
    yield* Effect.sleep(300)
    const posts = titlePosts(requests)
    expect(posts.length).toBeGreaterThanOrEqual(1)
    expect(posts[posts.length - 1].body).toEqual({ title: "First rename after restart", generated: false })
    // Sanity: we actually changed away from the seeded title.
    expect(priorTitle).not.toBe("First rename after restart")
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        if (originalTimeout === undefined) delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
        else process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalTimeout
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("reportSessionTitle goes through readiness and tolerates POST failure", () => {
  const originalKey = process.env.KILO_API_KEY
  const originalIngest = process.env.KILO_SESSION_INGEST_URL
  const originalTimeout = process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
  const requests: Req[] = []
  let titleStatus = 500
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input)
      const path = new URL(url).pathname
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        requests.push({ method: "POST", path })
        return Response.json({ id: "remote-r", ingestPath: "/api/session/remote-r/ingest" })
      }
      if (path.endsWith("/title")) {
        requests.push({ method: "POST", path })
        return new Response("fail", { status: titleStatus })
      }
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "test-token"
  process.env.KILO_SESSION_INGEST_URL = "https://ingest.kilosessions.ai"
  process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = "5000"
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    const created = yield* sessions.create({})
    yield* Effect.promise(() => KiloSessions.bootstrap(created.id))

    const failed = yield* kilo.reportSessionTitle(created.id, "X", { generated: false })
    expect(failed).toEqual({ ok: false, reason: "http_500" })
    expect(requests.some((r) => r.path.endsWith("/title"))).toBe(true)

    titleStatus = 200
    const ok = yield* kilo.reportSessionTitle(created.id, "Y", { generated: true })
    expect(ok).toEqual({ ok: true })
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        if (originalIngest === undefined) delete process.env.KILO_SESSION_INGEST_URL
        else process.env.KILO_SESSION_INGEST_URL = originalIngest
        if (originalTimeout === undefined) delete process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS
        else process.env.KILO_AGENT_NOTIFICATION_TIMEOUT_MS = originalTimeout
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("reportSessionTitle reports not_connected when unauthenticated", () => {
  const originalKey = process.env.KILO_API_KEY
  delete process.env.KILO_API_KEY
  reset()

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const result = yield* kilo.reportSessionTitle("ses_x", "T", { generated: false })
    expect(result).toEqual({ ok: false, reason: "not_connected" })
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (originalKey === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = originalKey
        reset()
      }),
    ),
    Effect.provide(layer()),
  )
})
