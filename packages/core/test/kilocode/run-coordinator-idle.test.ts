import { describe, expect } from "bun:test"
import { Deferred, Effect, Fiber, Layer } from "effect"
import { SessionRunCoordinator } from "../../src/session/run-coordinator"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

// ExecutionDrain depends on this notification contract; pin it against the real coordinator so upstream merges that
// move `settle` or `start` fail here first.
describe("SessionRunCoordinator idle notification", () => {
  it.effect("fires once after a coalesced chain, not between runs", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const idle = yield* Deferred.make<void>()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make<string, never>({
        drain: () =>
          Effect.gen(function* () {
            runs++
            events.push(`run ${runs}`)
            if (runs === 1) return yield* Deferred.await(first)
            yield* Deferred.succeed(started, undefined)
            return yield* Deferred.await(second)
          }),
        idle: (key) => {
          events.push(`idle ${key}`)
          Deferred.doneUnsafe(idle, Effect.void)
        },
      })
      yield* coordinator.wake("a")
      yield* coordinator.wake("a")
      yield* Deferred.succeed(first, undefined)
      yield* Deferred.await(started)
      expect(events).toEqual(["run 1", "run 2"])
      yield* Deferred.succeed(second, undefined)
      yield* Deferred.await(idle)
      expect(events).toEqual(["run 1", "run 2", "idle a"])
    }),
  )

  it.effect("does not fire when a failure hands off to a pending successor", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const first = yield* Deferred.make<void>()
      const second = yield* Deferred.make<void>()
      const started = yield* Deferred.make<void>()
      const idle = yield* Deferred.make<void>()
      let runs = 0
      const coordinator = yield* SessionRunCoordinator.make<string, string>({
        drain: () =>
          Effect.gen(function* () {
            runs++
            events.push(`run ${runs}`)
            if (runs === 1) return yield* Deferred.await(first).pipe(Effect.andThen(Effect.fail("expected failure")))
            yield* Deferred.succeed(started, undefined)
            return yield* Deferred.await(second)
          }),
        idle: (key) => {
          events.push(`idle ${key}`)
          Deferred.doneUnsafe(idle, Effect.void)
        },
      })
      yield* coordinator.wake("a")
      yield* coordinator.wake("a")
      yield* Deferred.succeed(first, undefined)
      yield* Deferred.await(started)
      expect(events).toEqual(["run 1", "run 2"])
      yield* Deferred.succeed(second, undefined)
      yield* Deferred.await(idle)
      expect(events).toEqual(["run 1", "run 2", "idle a"])
    }),
  )

  it.effect("fires after interruption cleanup and after leaving active, before waiters resume", () =>
    Effect.gen(function* () {
      const events: string[] = []
      const started = yield* Deferred.make<void>()
      const cleaning = yield* Deferred.make<void>()
      const cleaned = yield* Deferred.make<void>()
      const coordinator: SessionRunCoordinator.Coordinator<string, never> = yield* SessionRunCoordinator.make<
        string,
        never
      >({
        drain: () =>
          Deferred.succeed(started, undefined).pipe(
            Effect.andThen(Effect.never),
            Effect.ensuring(
              Effect.sync(() => events.push("cleanup")).pipe(
                Effect.andThen(Deferred.succeed(cleaning, undefined)),
                Effect.andThen(Deferred.await(cleaned)),
              ),
            ),
          ),
        idle: (key) => events.push(`idle ${key} active=${Effect.runSync(coordinator.active).has(key)}`),
      })
      const caller = yield* coordinator
        .run("a")
        .pipe(Effect.ensuring(Effect.sync(() => events.push("resumed"))), Effect.exit, Effect.forkChild)
      yield* Deferred.await(started)
      const stopping = yield* coordinator.interrupt("a").pipe(Effect.forkChild)
      yield* Deferred.await(cleaning)
      expect(events).toEqual(["cleanup"])
      yield* Deferred.succeed(cleaned, undefined)
      yield* Fiber.join(stopping)
      yield* Fiber.join(caller)
      expect(events).toEqual(["cleanup", "idle a active=false", "resumed"])
    }),
  )
})
