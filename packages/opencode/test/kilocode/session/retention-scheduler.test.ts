import { expect } from "bun:test"
import { Context, Deferred, Effect, Fiber, Layer } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { rm } from "node:fs/promises"
import path from "node:path"
import { Database } from "@opencode-ai/core/database/database"
import { Global } from "@opencode-ai/core/global"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { Config } from "../../../src/config/config"
import { Session } from "../../../src/session/session"
import { KiloShutdown } from "../../../src/kilocode/cli/shutdown"
import { KiloSessionRetention } from "../../../src/kilocode/session/retention"
import { KiloRetentionScheduler } from "../../../src/kilocode/session/retention-scheduler"
import { testEffect } from "../../lib/effect"

const it = testEffect(
  LayerNode.compile(LayerNode.group([Session.node, SessionProjector.node, Database.node, CrossSpawnSpawner.node])),
)
const file = path.join(Global.Path.data, "retention", "state.json")
const reset = Effect.promise(() => rm(file, { force: true }))
const load = (config: Layer.Layer<Config.Service>) =>
  Layer.build(KiloRetentionScheduler.layer.pipe(Layer.provide(config))).pipe(
    Effect.map((context) => Context.get(context, KiloRetentionScheduler.Service)),
  )
const start = (config: Layer.Layer<Config.Service>) => load(config).pipe(Effect.tap((s) => s.start()))

it.effect("building the runtime for a utility command neither starts nor drains cleanup", () =>
  Effect.gen(function* () {
    yield* reset
    let calls = 0
    const config = Layer.mock(Config.Service, {
      getGlobal: () =>
        Effect.sync(() => {
          calls++
          return { retention: { enabled: true, maxAgeDays: 90 } }
        }),
    })
    yield* load(config)
    yield* TestClock.adjust("2 hours")
    yield* Effect.promise(() => KiloShutdown.run())
    expect(calls).toBe(0)
    expect(yield* KiloSessionRetention.readState()).toBeNull()
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)

it.effect("startup immediately runs enabled retention without waiting for the hourly timer", () =>
  Effect.gen(function* () {
    yield* reset
    let calls = 0
    const config = Layer.mock(Config.Service, {
      getGlobal: () =>
        Effect.sync(() => {
          calls++
          return { retention: { enabled: true, maxAgeDays: 30 } }
        }),
    })
    const scheduler = yield* start(config)
    expect(calls).toBeGreaterThanOrEqual(1)
    yield* scheduler.start()
    yield* scheduler.stop(true)
    expect(calls).toBe(2)
    expect(yield* KiloSessionRetention.readState()).toMatchObject({ scanned: 0, deleted: 0 })
    expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
  }),
)

for (const reason of ["disabled", "recent"] as const) {
  it.effect(`startup skips ${reason} retention without entering the deletion pass`, () =>
    Effect.gen(function* () {
      yield* reset
      const previous = {
        at: Date.now(),
        scanned: 0,
        deleted: 0,
        skippedActive: 0,
        failed: 0,
        durationMs: 0,
      }
      if (reason === "recent") yield* Effect.promise(() => Bun.write(file, JSON.stringify(previous)))
      let calls = 0
      const config = Layer.mock(Config.Service, {
        getGlobal: () =>
          Effect.sync(() => {
            calls++
            return { retention: { enabled: reason !== "disabled", maxAgeDays: 30 } }
          }),
      })
      const scheduler = yield* start(config)
      yield* scheduler.stop(true)
      expect(calls).toBe(1)
      expect(yield* KiloSessionRetention.readState()).toEqual(reason === "recent" ? previous : null)
      expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
    }),
  )
}

it.effect("hourly check reloads global policy after disabled startup", () =>
  Effect.gen(function* () {
    yield* reset
    let enabled = false
    let calls = 0
    const entered = yield* Deferred.make<void>()
    const config = Layer.mock(Config.Service, {
      getGlobal: () =>
        Effect.gen(function* () {
          if (++calls === 3) yield* Deferred.succeed(entered, undefined)
          return { retention: { enabled, maxAgeDays: 90 } }
        }),
    })
    const scheduler = yield* start(config)
    expect(calls).toBe(1)
    expect(yield* KiloSessionRetention.readState()).toBeNull()
    enabled = true
    yield* TestClock.adjust("1 hour")
    yield* Deferred.await(entered)
    yield* scheduler.stop(true)
    expect(calls).toBe(3)
    expect(yield* KiloSessionRetention.readState()).toMatchObject({ scanned: 0, deleted: 0 })
    yield* TestClock.adjust("2 hours")
    expect(calls).toBe(3)
  }),
)

for (const drain of [true, false]) {
  it.effect(`shutdown ${drain ? "drains" : "interrupts"} the active retention pass`, () =>
    Effect.gen(function* () {
      yield* reset
      let calls = 0
      const entered = yield* Deferred.make<void>()
      const resume = yield* Deferred.make<void>()
      const config = Layer.mock(Config.Service, {
        getGlobal: () =>
          Effect.gen(function* () {
            if (++calls === 2) {
              yield* Deferred.succeed(entered, undefined)
              yield* Deferred.await(resume)
            }
            return { retention: { enabled: true, maxAgeDays: 30 } }
          }),
      })
      const scheduler = yield* start(config)
      yield* Deferred.await(entered)
      expect((yield* KiloSessionRetention.readProgress())?.phase).toBe("scanning")
      if (drain) {
        const stopping = yield* Effect.promise(() => KiloShutdown.run()).pipe(
          Effect.forkChild({ startImmediately: true }),
        )
        expect(stopping.pollUnsafe()).toBeUndefined()
        yield* Deferred.succeed(resume, undefined)
        yield* Fiber.join(stopping)
        expect(yield* KiloSessionRetention.readState()).toMatchObject({ scanned: 0, deleted: 0 })
      }
      if (!drain) {
        yield* scheduler.stop()
        expect(yield* KiloSessionRetention.readState()).toBeNull()
      }
      expect(yield* KiloSessionRetention.readProgress()).toBeUndefined()
      yield* TestClock.adjust("2 hours")
      expect(calls).toBe(2)
    }),
  )
}
