import { afterEach, beforeEach, expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../../src/auth"
import { Bus } from "../../../src/bus"
import { GlobalBus } from "../../../src/bus/global"
import type { Config } from "../../../src/config/config"
import { clearInFlightCache } from "../../../src/kilo-sessions/inflight-cache"
import {
  clearAll as clearRenameMarks,
  consumeAutoTitle,
  consumeRenameAdoption,
  markAutoTitle,
  markRenameAdopted,
} from "../../../src/kilo-sessions/rename-adoptions"
import { Session } from "../../../src/session/session"
import { TestConfig } from "../../fixture/config"
import { pollWithTimeout, testEffect } from "../../lib/effect"
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

const ENV_KEYS = ["KILO_API_KEY", "KILO_SESSION_INGEST_URL", "KILO_ORG_ID", "KILO_AGENT_NOTIFICATION_TIMEOUT_MS"] as const

/** Snapshot env keys we patch so afterEach can restore even if layer build fails. */
const envSnap = new Map<string, string | undefined>()
let fetchSpy: ReturnType<typeof spyOn> | undefined

function snapEnv() {
  for (const key of ENV_KEYS) {
    if (!envSnap.has(key)) envSnap.set(key, process.env[key])
  }
}

function restoreEnv() {
  for (const [key, value] of envSnap) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  envSnap.clear()
}

function restoreFetch() {
  fetchSpy?.mockRestore()
  fetchSpy = undefined
}

beforeEach(() => {
  delete process.env.KILO_ORG_ID
  clearRenameMarks()
})

// Safety net: restore fetch + env even when Effect.provide / layer construction fails
// before Effect.ensuring runs (finding 7).
afterEach(() => {
  restoreFetch()
  restoreEnv()
  delete process.env.KILO_ORG_ID
  clearRenameMarks()
  reset("test-token")
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

function patchEnv(values: Record<string, string | undefined>) {
  snapEnv()
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function installFetch(impl: typeof globalThis.fetch) {
  restoreFetch()
  fetchSpy = spyOn(globalThis, "fetch").mockImplementation(impl)
  return fetchSpy
}

/** Wait until title POSTs reach at least `n`. */
function waitTitlePosts(requests: Req[], n: number, message: string) {
  return pollWithTimeout(
    Effect.sync(() => (titlePosts(requests).length >= n ? titlePosts(requests) : undefined)),
    message,
    "5 seconds",
  )
}

/** After expecting `n` title POSTs, hold briefly and assert the count stays `n`. */
function holdTitlePosts(requests: Req[], n: number) {
  return Effect.gen(function* () {
    const start = Date.now()
    while (Date.now() - start < 200) {
      expect(titlePosts(requests)).toHaveLength(n)
      yield* Effect.sleep(20)
    }
    expect(titlePosts(requests)).toHaveLength(n)
  })
}

/** Drain ingest after debounce; used when waiting on meta items. */
const drainIngest = Effect.gen(function* () {
  yield* Effect.sleep(1200)
  yield* Effect.promise(() => KiloSessions.drainIngestForShutdown())
})

it.instance("meta org precedence: session metadata > KILO_ORG_ID > auth accountId", () => {
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_ORG_ID: ORG_ENV,
  })
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
    // Failure-safe: remove oauth even when an assertion fails mid-test (auth is
    // not restored by afterEach — only fetch/env/rename marks are).
    yield* Effect.gen(function* () {
      yield* kilo.init()

      // 1) metadata wins over env
      const withMeta = yield* sessions.create({ metadata: { orgId: ORG_META } })
      yield* Effect.promise(() => KiloSessions.bootstrap(withMeta.id))
      requests.length = 0
      emitUpdated(instance.directory, withMeta.id, withMeta.title)
      yield* drainIngest
      expect(metaItems(requests).some((m) => m.orgId === ORG_META)).toBe(true)

      // 2) env wins when metadata absent
      requests.length = 0
      const plain = yield* sessions.create({})
      yield* Effect.promise(() => KiloSessions.bootstrap(plain.id))
      requests.length = 0
      emitUpdated(instance.directory, plain.id, plain.title)
      yield* drainIngest
      expect(metaItems(requests).some((m) => m.orgId === ORG_ENV)).toBe(true)

      // 3) auth accountId when env cleared
      delete process.env.KILO_ORG_ID
      clearInFlightCache("kilo-sessions:org")
      requests.length = 0
      const authOnly = yield* sessions.create({})
      yield* Effect.promise(() => KiloSessions.bootstrap(authOnly.id))
      requests.length = 0
      emitUpdated(instance.directory, authOnly.id, authOnly.title)
      yield* drainIngest
      expect(metaItems(requests).some((m) => m.orgId === ORG_AUTH)).toBe(true)
    }).pipe(Effect.ensuring(auth.remove("kilo").pipe(Effect.orDie)))
  }).pipe(Effect.provide(layer()))
})

it.instance("meta falls through invalid metadata orgId to env", () => {
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_ORG_ID: ORG_ENV,
  })
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    const instance = yield* TestInstance
    yield* kilo.init()

    const bad = yield* sessions.create({ metadata: { orgId: "not-a-uuid" } })
    yield* Effect.promise(() => KiloSessions.bootstrap(bad.id))
    requests.length = 0
    emitUpdated(instance.directory, bad.id, bad.title)
    yield* drainIngest
    expect(metaItems(requests).some((m) => m.orgId === ORG_ENV)).toBe(true)
  }).pipe(Effect.provide(layer()))
})

it.instance("meta falls back to env when session row has no resolvable org", () => {
  // Precedence only: real Updated → kilo_meta with a live session that has no
  // orgId in metadata. Does not exercise Session.get failure (see next test).
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_ORG_ID: ORG_ENV,
  })
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    const instance = yield* TestInstance
    yield* kilo.init()

    const plain = yield* sessions.create({})
    yield* Effect.promise(() => KiloSessions.bootstrap(plain.id))
    yield* drainIngest
    requests.length = 0
    emitUpdated(instance.directory, plain.id, plain.title)
    yield* drainIngest
    expect(metaItems(requests).some((m) => m.orgId === ORG_ENV)).toBe(true)
    expect(metaItems(requests).every((m) => m.orgId !== ORG_META && m.orgId !== ORG_AUTH)).toBe(true)
  }).pipe(Effect.provide(layer()))
})

it.instance("meta falls back to env when Session.Service.get fails", () => {
  // meta(sessionId) with no preloaded info: resolveSessionOrg loads via the
  // global runtime; unknown id → get rejects → .catch(() => null) → KILO_ORG_ID.
  // Must not throw or drop the process-global org claim on a fetch blip.
  // Production callers pass info; this path is API robustness when they omit it.
  patchEnv({ KILO_ORG_ID: ORG_ENV })
  clearInFlightCache("kilo-sessions:org")

  return Effect.gen(function* () {
    const result = yield* Effect.promise(() => KiloSessions._metaForTests("ses_missing_for_meta_get_fail"))
    expect(result.orgId).toBe(ORG_ENV)
  }).pipe(Effect.provide(layer()))
})

it.instance("title broadcast: auto-title posts generated true; custom posts generated false; adoption skips", () => {
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_AGENT_NOTIFICATION_TIMEOUT_MS: "5000",
  })
  reset("test-token")

  return Effect.gen(function* () {
    const instance = yield* TestInstance
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    yield* kilo.init()

    const created = yield* sessions.create({})
    const id = created.id
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    const defaultTitle = created.title
    expect(Session.isDefaultTitle(defaultTitle)).toBe(true)

    // Created seeds knownTitles; same-title Updated is a no-op POST-wise.
    emitUpdated(instance.directory, id, defaultTitle)
    yield* holdTitlePosts(requests, 0)

    // Auto-title: mark then setTitle so Updated consumer sees generated:true.
    const auto = "Auto generated title"
    markAutoTitle(id, auto)
    yield* sessions.setTitle({ sessionID: id, title: auto })
    {
      const posts = yield* waitTitlePosts(requests, 1, "auto-title never POSTed")
      expect(posts[posts.length - 1].body).toEqual({ title: auto, generated: true })
      expect(posts[posts.length - 1].path).toBe(`/api/session/${id}/title`)
    }
    expect(consumeAutoTitle(id, auto)).toBe(false)

    requests.length = 0
    yield* sessions.setTitle({ sessionID: id, title: "Custom A" })
    {
      const posts = yield* waitTitlePosts(requests, 1, "custom A never POSTed")
      expect(posts[posts.length - 1].body).toEqual({ title: "Custom A", generated: false })
    }

    requests.length = 0
    yield* sessions.setTitle({ sessionID: id, title: "Custom B" })
    {
      const posts = yield* waitTitlePosts(requests, 1, "custom B never POSTed")
      expect(posts[posts.length - 1].body).toEqual({ title: "Custom B", generated: false })
    }

    requests.length = 0
    markRenameAdopted(id, "From cloud")
    yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
    yield* holdTitlePosts(requests, 0)
    expect(consumeRenameAdoption(id, "From cloud")).toBe(false)
  }).pipe(Effect.provide(layer()))
})

it.instance(
  "title broadcast: same-title Updated consumes rename adoption (double session.renamed)",
  () => {
    const requests: Req[] = []
    installFetch(mockFetch(requests))
    patchEnv({
      KILO_API_KEY: "test-token",
      KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
      KILO_AGENT_NOTIFICATION_TIMEOUT_MS: "5000",
    })
    reset("test-token")

    return Effect.gen(function* () {
      const kilo = yield* KiloSessions.Service
      const sessions = yield* Session.Service
      yield* kilo.init()

      const created = yield* sessions.create({})
      const id = created.id
      yield* Effect.promise(() => KiloSessions.bootstrap(id))
      yield* Effect.sleep(50)
      requests.length = 0

      markRenameAdopted(id, "From cloud")
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      yield* holdTitlePosts(requests, 0)
      expect(consumeRenameAdoption(id, "From cloud")).toBe(false)

      markRenameAdopted(id, "From cloud")
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      yield* holdTitlePosts(requests, 0)
      expect(consumeRenameAdoption(id, "From cloud")).toBe(false)

      requests.length = 0
      yield* sessions.setTitle({ sessionID: id, title: "Local rename away" })
      yield* waitTitlePosts(requests, 1, "local rename away never POSTed")
      yield* sessions.setTitle({ sessionID: id, title: "From cloud" })
      const posts = yield* waitTitlePosts(requests, 2, "local rename back never POSTed")
      expect(posts.some((p) => p.body?.title === "From cloud" && p.body?.generated === false)).toBe(true)
    }).pipe(Effect.provide(layer()))
  },
  15_000,
)

it.instance("title broadcast: first rename after create (rename-before-prompt) POSTs", () => {
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_AGENT_NOTIFICATION_TIMEOUT_MS: "5000",
  })
  reset("test-token")

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const sessions = yield* Session.Service
    yield* kilo.init()

    const created = yield* sessions.create({})
    const id = created.id
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    yield* sessions.setTitle({ sessionID: id, title: "Renamed before prompt" })
    const posts = yield* waitTitlePosts(requests, 1, "rename-before-prompt never POSTed")
    expect(posts[posts.length - 1].body).toEqual({ title: "Renamed before prompt", generated: false })
  }).pipe(Effect.provide(layer()))
})

it.instance("title broadcast: first rename after restart seeds from list and POSTs", () => {
  const requests: Req[] = []
  installFetch(mockFetch(requests))
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_AGENT_NOTIFICATION_TIMEOUT_MS: "5000",
  })
  reset("test-token")

  return Effect.gen(function* () {
    const sessions = yield* Session.Service
    const existing = yield* sessions.create({})
    const id = existing.id
    const priorTitle = existing.title

    const kilo = yield* KiloSessions.Service
    yield* kilo.init()
    yield* Effect.promise(() => KiloSessions.bootstrap(id))
    yield* Effect.sleep(50)
    requests.length = 0

    yield* sessions.setTitle({ sessionID: id, title: "First rename after restart" })
    const posts = yield* waitTitlePosts(requests, 1, "first rename after restart never POSTed")
    expect(posts[posts.length - 1].body).toEqual({ title: "First rename after restart", generated: false })
    expect(priorTitle).not.toBe("First rename after restart")
  }).pipe(Effect.provide(layer()))
})

it.instance("reportSessionTitle goes through readiness and tolerates POST failure", () => {
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
  installFetch(fetch)
  patchEnv({
    KILO_API_KEY: "test-token",
    KILO_SESSION_INGEST_URL: "https://ingest.kilosessions.ai",
    KILO_AGENT_NOTIFICATION_TIMEOUT_MS: "5000",
  })
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
  }).pipe(Effect.provide(layer()))
})

it.instance("reportSessionTitle reports not_connected when unauthenticated", () => {
  patchEnv({ KILO_API_KEY: undefined })
  delete process.env.KILO_API_KEY
  reset()

  return Effect.gen(function* () {
    const kilo = yield* KiloSessions.Service
    const result = yield* kilo.reportSessionTitle("ses_x", "T", { generated: false })
    expect(result).toEqual({ ok: false, reason: "not_connected" })
  }).pipe(Effect.provide(layer()))
})
