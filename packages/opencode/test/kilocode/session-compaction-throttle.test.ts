import { describe, expect } from "bun:test"
import { Clock, Deferred, Effect, Fiber, Ref } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { KiloCompactionThrottle } from "../../src/kilocode/session/compaction-throttle"
import { MessageV2 } from "../../src/session/message-v2"
import { it } from "../lib/effect"

function api(input: { message: string; statusCode?: number; responseBody?: string }) {
  return new MessageV2.APIError({
    ...input,
    isRetryable: true,
  }).toObject()
}

describe("KiloCompactionThrottle", () => {
  it.effect("starts concurrently then serializes requests after provider pressure", () =>
    Effect.gen(function* () {
      const throttle = yield* KiloCompactionThrottle.make()
      const active = yield* Ref.make(0)
      const peak = yield* Ref.make(0)
      const ready = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const concurrent = throttle.gate(
        Effect.gen(function* () {
          const count = yield* Ref.modify(active, (value) => [value + 1, value + 1])
          yield* Ref.update(peak, (value) => Math.max(value, count))
          if (count === 3) yield* Deferred.succeed(ready, undefined)
          yield* Deferred.await(release)
        }).pipe(Effect.ensuring(Ref.update(active, (value) => value - 1))),
      )
      const first = yield* Effect.forEach([0, 1, 2], () => concurrent, { concurrency: 3 }).pipe(Effect.forkChild)

      yield* Deferred.await(ready)
      expect(yield* Ref.get(peak)).toBe(3)
      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(first)

      yield* throttle.retry({
        error: api({ message: "Too many requests", statusCode: 429 }),
        next: 0,
      })

      const order = yield* Ref.make(0)
      const signals = yield* Effect.forEach([0, 1, 2], () => Deferred.make<void>())
      const releases = yield* Effect.forEach([0, 1, 2], () => Deferred.make<void>())
      const serial = throttle.gate(
        Effect.gen(function* () {
          const index = yield* Ref.modify(order, (value) => [value, value + 1])
          yield* Deferred.succeed(signals[index], undefined)
          yield* Deferred.await(releases[index])
        }),
      )
      const second = yield* Effect.forEach([0, 1, 2], () => serial, { concurrency: 3 }).pipe(Effect.forkChild)

      yield* Deferred.await(signals[0])
      yield* Effect.yieldNow
      expect(yield* Ref.get(order)).toBe(1)
      yield* Deferred.succeed(releases[0], undefined)
      yield* Deferred.await(signals[1])
      expect(yield* Ref.get(order)).toBe(2)
      yield* Deferred.succeed(releases[1], undefined)
      yield* Deferred.await(signals[2])
      expect(yield* Ref.get(order)).toBe(3)
      yield* Deferred.succeed(releases[2], undefined)
      yield* Fiber.join(second)
    }),
  )

  it.effect("holds serialized requests until the shared retry deadline", () =>
    Effect.gen(function* () {
      const throttle = yield* KiloCompactionThrottle.make()
      const done = yield* Deferred.make<void>()
      const now = yield* Clock.currentTimeMillis
      yield* throttle.retry({
        error: api({ message: "Rate limit exceeded", statusCode: 429 }),
        next: now + 1_000,
      })

      const fiber = yield* throttle.gate(Deferred.succeed(done, undefined)).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      expect(yield* Deferred.isDone(done)).toBe(false)

      yield* TestClock.adjust("999 millis")
      expect(yield* Deferred.isDone(done)).toBe(false)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(fiber)
      expect(yield* Deferred.isDone(done)).toBe(true)
    }),
  )

  it.effect("honors retry deadline extensions while a request is waiting", () =>
    Effect.gen(function* () {
      const throttle = yield* KiloCompactionThrottle.make()
      const done = yield* Deferred.make<void>()
      const now = yield* Clock.currentTimeMillis
      const error = api({ message: "Rate limit exceeded", statusCode: 429 })
      yield* throttle.retry({ error, next: now + 1_000 })

      const fiber = yield* throttle.gate(Deferred.succeed(done, undefined)).pipe(Effect.forkChild)
      yield* Effect.yieldNow
      yield* TestClock.adjust("500 millis")
      yield* throttle.retry({ error, next: now + 2_000 })

      yield* TestClock.adjust("500 millis")
      expect(yield* Deferred.isDone(done)).toBe(false)
      yield* TestClock.adjust("999 millis")
      expect(yield* Deferred.isDone(done)).toBe(false)
      yield* TestClock.adjust("1 millis")
      yield* Fiber.join(fiber)
      expect(yield* Deferred.isDone(done)).toBe(true)
    }),
  )

  it.effect("only treats explicit provider pressure as a throttle signal", () =>
    Effect.sync(() => {
      expect(KiloCompactionThrottle.pressure(api({ message: "busy", statusCode: 429 }))).toBe(true)
      expect(
        KiloCompactionThrottle.pressure(
          api({
            message: "request failed",
            responseBody: '{"error":{"code":"RESOURCE_EXHAUSTED"}}',
          }),
        ),
      ).toBe(true)
      expect(
        KiloCompactionThrottle.pressure(api({ message: '{"type":"error","error":{"type":"too_many_requests"}}' })),
      ).toBe(true)
      expect(KiloCompactionThrottle.pressure(api({ message: "Provider is overloaded" }))).toBe(true)
      expect(KiloCompactionThrottle.pressure(api({ message: "Service unavailable", statusCode: 503 }))).toBe(false)
      expect(KiloCompactionThrottle.pressure(api({ message: "Network connection reset" }))).toBe(false)
    }),
  )
})
