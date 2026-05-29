// kilocode_change - new file
import { expect, spyOn } from "bun:test"
import { Effect, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Auth } from "../../src/auth"
import { Bus } from "../../src/bus"
import type { Config } from "../../src/config/config"
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
        request.mockRestore()
      }),
    ),
    Effect.provide(layer()),
  )
})
