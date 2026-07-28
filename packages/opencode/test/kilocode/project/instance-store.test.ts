import { describe, expect } from "bun:test"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { GlobalBus } from "../../../src/bus/global"
import { registerDisposer } from "../../../src/effect/instance-registry"
import { InstanceBootstrap } from "../../../src/project/bootstrap-service"
import { InstanceStore } from "../../../src/project/instance-store"
import { tmpdirScoped } from "../../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../../lib/effect"

const bootstrap = Layer.succeed(InstanceBootstrap.Service, InstanceBootstrap.Service.of({ run: Effect.void }))
const it = testEffect(
  Layer.mergeAll(InstanceStore.defaultLayer, CrossSpawnSpawner.defaultLayer).pipe(Layer.provide(bootstrap)),
)

const register = (disposer: (directory: string) => Promise<void>) =>
  Effect.acquireRelease(
    Effect.sync(() => registerDisposer(disposer)),
    (off) => Effect.sync(off),
  )

describe("InstanceStore disposal", () => {
  it.live("disposes four directories concurrently", () =>
    Effect.gen(function* () {
      const dirs = yield* Effect.all(
        Array.from({ length: 4 }, () => tmpdirScoped({ git: true })),
        { concurrency: "unbounded" },
      )
      const store = yield* InstanceStore.Service
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const started = new Set<string>()

      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.ignore))
      yield* register(async (directory) => {
        if (!dirs.includes(directory)) return
        started.add(directory)
        if (started.size === dirs.length) Deferred.doneUnsafe(ready, Effect.void)
        await Effect.runPromise(Deferred.await(release))
      })

      yield* Effect.forEach(dirs, (directory) => store.load({ directory }), { discard: true })
      const fiber = yield* store.disposeAll().pipe(Effect.forkScoped)

      yield* awaitWithTimeout(Deferred.await(ready), "instance disposal remained serial")
      expect(started).toEqual(new Set(dirs))

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(fiber)
    }),
  )

  it.live("finishes sibling disposal when an event listener throws", () =>
    Effect.gen(function* () {
      const dirs = yield* Effect.all(
        Array.from({ length: 4 }, () => tmpdirScoped({ git: true })),
        { concurrency: "unbounded" },
      )
      const store = yield* InstanceStore.Service
      const before = yield* Effect.forEach(dirs, (directory) => store.load({ directory }))
      const disposed = new Set<string>()
      const listener = (event: { directory?: string; payload?: { type?: string } }) => {
        if (event.payload?.type === "server.instance.disposed" && event.directory === dirs[0]) {
          throw new Error("listener failed")
        }
      }

      yield* register(async (directory) => {
        if (dirs.includes(directory)) disposed.add(directory)
      })
      GlobalBus.on("event", listener)
      yield* Effect.addFinalizer(() => Effect.sync(() => GlobalBus.off("event", listener)))

      const exit = yield* Effect.exit(store.disposeAll())
      GlobalBus.off("event", listener)

      expect(Exit.isFailure(exit)).toBe(true)
      expect(disposed).toEqual(new Set(dirs))

      const after = yield* Effect.forEach(dirs, (directory) => store.load({ directory }))
      for (const [index, ctx] of after.entries()) {
        expect(ctx).not.toBe(before[index])
      }
    }),
  )

  it.live("finishes queued disposal when the caller is interrupted", () =>
    Effect.gen(function* () {
      const dirs = yield* Effect.all(
        Array.from({ length: 5 }, () => tmpdirScoped({ git: true })),
        { concurrency: "unbounded" },
      )
      const store = yield* InstanceStore.Service
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const started = new Set<string>()

      yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.ignore))
      yield* register(async (directory) => {
        if (!dirs.includes(directory)) return
        started.add(directory)
        if (started.size === 4) Deferred.doneUnsafe(ready, Effect.void)
        await Effect.runPromise(Deferred.await(release))
      })
      yield* Effect.forEach(dirs, (directory) => store.load({ directory }), { discard: true })

      const disposal = yield* store.disposeAll().pipe(Effect.forkScoped)
      yield* awaitWithTimeout(Deferred.await(ready), "bounded disposal did not start")
      const scope = yield* Scope.Scope
      const interrupted = yield* Fiber.interrupt(disposal).pipe(Effect.forkIn(scope, { startImmediately: true }))
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(interrupted)

      expect(started).toEqual(new Set(dirs))
    }),
  )
})
