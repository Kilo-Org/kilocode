// kilocode_change - new file
import { expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import type { Config } from "../../src/config/config"
import { clearInFlightCache } from "../../src/kilo-sessions/inflight-cache"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { ProjectID } from "../../src/project/schema"
import { Session } from "../../src/session/session"
import { SessionID } from "../../src/session/schema"
import { TestConfig } from "../fixture/config"
import { testEffect } from "../lib/effect"

const it = testEffect(CrossSpawnSpawner.defaultLayer)

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

it.instance("initializes once per instance through Config.Service", () => {
  let reads = 0

  return Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    yield* sessions.init()
    yield* sessions.init()
    expect(reads).toBe(1)
  }).pipe(
    Effect.provide(
      layer({
        getGlobal: () =>
          Effect.sync(() => {
            reads += 1
            return {}
          }),
      }),
    ),
  )
})

it.instance("bootstraps session ingest from KILO_API_KEY without stored auth", () => {
  const original = process.env.KILO_API_KEY
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/user")) {
        calls.push(new Headers(init?.headers).get("Authorization") ?? "")
        return new Response("{}", { status: 200 })
      }
      if (url.endsWith("/api/session")) {
        calls.push(new Headers(init?.headers).get("Authorization") ?? "")
        return Response.json({ id: "remote-env", ingestPath: "/api/ingest/env" })
      }
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "env-token"
  reset("env-token")

  return Effect.promise(() => KiloSessions.bootstrap("session-env")).pipe(
    Effect.andThen(() => Effect.sync(() => expect(calls).toEqual(["Bearer env-token", "Bearer env-token"]))),
    Effect.ensuring(
      Effect.sync(() => {
        if (original === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = original
        reset("env-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("prefers stored auth over KILO_API_KEY for session ingest", () => {
  const original = process.env.KILO_API_KEY
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/api/user")) {
        calls.push(new Headers(init?.headers).get("Authorization") ?? "")
        return new Response("{}", { status: 200 })
      }
      if (url.endsWith("/api/session")) {
        calls.push(new Headers(init?.headers).get("Authorization") ?? "")
        return Response.json({ id: "remote-auth", ingestPath: "/api/ingest/auth" })
      }
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  process.env.KILO_API_KEY = "env-token"
  reset("env-token", "stored-token")

  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    yield* auth.set("kilo", { type: "api", key: "stored-token" })
    yield* Effect.promise(() => KiloSessions.bootstrap("session-auth"))
    expect(calls).toEqual(["Bearer stored-token", "Bearer stored-token"])
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        if (original === undefined) delete process.env.KILO_API_KEY
        else process.env.KILO_API_KEY = original
        reset("env-token", "stored-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})

it.instance("does not duplicate created-session subscribers when init is repeated", () => {
  const calls: string[] = []
  const fetch: typeof globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith("/api/user")) return new Response("{}", { status: 200 })
      if (url.endsWith("/api/session")) {
        calls.push(url)
        return Response.json({ id: "remote-1", ingestPath: "/api/ingest/session-1" })
      }
      return new Response("{}", { status: 200 })
    },
    { preconnect: globalThis.fetch.preconnect },
  )
  const request = spyOn(globalThis, "fetch").mockImplementation(fetch)

  reset("test-token")
  const id = SessionID.descending("session-created")

  return Effect.gen(function* () {
    const auth = yield* Auth.Service
    const bus = yield* Bus.Service
    const sessions = yield* KiloSessions.Service
    yield* auth.set("kilo", { type: "api", key: "test-token" })
    yield* sessions.init()
    yield* sessions.init()
    yield* Effect.sleep(50)
    yield* bus.publish(Session.Event.Created, {
      sessionID: id,
      info: {
        id,
        slug: "test",
        projectID: ProjectID.make("project-test"),
        directory: "/tmp/test",
        title: "test",
        version: "test",
        time: { created: Date.now(), updated: Date.now() },
      },
    })
    yield* Effect.sleep(50)
    expect(calls).toHaveLength(1)
  }).pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        const auth = yield* Auth.Service
        yield* auth.remove("kilo").pipe(Effect.orDie)
        reset("test-token")
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})
