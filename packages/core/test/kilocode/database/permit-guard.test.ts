import { describe, expect, test } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Semaphore } from "effect"
import * as Client from "effect/unstable/sql/SqlClient"
import { layer as sqliteLayer } from "@opencode-ai/core/database/sqlite.bun"
import { isBusy } from "@opencode-ai/core/kilocode/sqlite-error"
import {
  PermitGuard,
  SqlitePermitTimeoutLabel,
  isPermitTimeoutSqlError,
} from "@opencode-ai/core/kilocode/database/permit-guard"

describe("PermitGuard.takeWithTimeout", () => {
  test("fails with a retryable LockTimeout SqlError while the permit is held", async () => {
    const program = Effect.gen(function* () {
      const sem = yield* Semaphore.make(1)
      const holderStarted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* sem
        .withPermits(1)(Deferred.succeed(holderStarted, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(holderStarted)

      const exit = yield* PermitGuard.takeWithTimeout(sem, 1, "statement", "100 millis").pipe(Effect.exit)
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isSuccess(exit)) throw new Error("expected timed-out take to fail")

      const error = Cause.squash(exit.cause)
      expect(isPermitTimeoutSqlError(error)).toBe(true)
      // The existing busy-error channel (retries + HTTP 503 "database busy") must recognize it.
      expect(isBusy(error)).toBe(true)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)
    })
    await Effect.runPromise(program)
  })

  test("does not leak a permit when the wait times out", async () => {
    const program = Effect.gen(function* () {
      const sem = yield* Semaphore.make(1)
      const holderStarted = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const holder = yield* sem
        .withPermits(1)(Deferred.succeed(holderStarted, undefined).pipe(Effect.andThen(Deferred.await(release))))
        .pipe(Effect.forkChild)
      yield* Deferred.await(holderStarted)

      // Two waiters time out behind the held permit; neither may consume a permit.
      const first = yield* PermitGuard.takeWithTimeout(sem, 1, "statement", "50 millis").pipe(Effect.exit)
      const second = yield* PermitGuard.takeWithTimeout(sem, 1, "statement", "50 millis").pipe(Effect.exit)
      expect(Exit.isFailure(first)).toBe(true)
      expect(Exit.isFailure(second)).toBe(true)

      yield* Deferred.succeed(release, undefined)
      yield* Fiber.join(holder)

      // The single permit must be fully available again immediately.
      const acquired = yield* PermitGuard.takeWithTimeout(sem, 1, "statement", "100 millis")
      expect(acquired).toBe(1)

      // Exactly one permit exists: while holding it, a second non-blocking acquisition must fail.
      // This catches an over-release (e.g. a timed-out waiter wrongly returning a permit it never held).
      const immediate = yield* sem.withPermitsIfAvailable(1)(Effect.succeed("ok"))
      expect(Option.isNone(immediate)).toBe(true)

      yield* sem.release(1)
      const afterRelease = yield* sem.withPermitsIfAvailable(1)(Effect.succeed("ok"))
      expect(Option.isSome(afterRelease)).toBe(true)
    })
    await Effect.runPromise(program)
  })

  test("acquires immediately when the permit is free", async () => {
    const program = Effect.gen(function* () {
      const sem = yield* Semaphore.make(1)
      const acquired = yield* PermitGuard.takeWithTimeout(sem, 1, "transaction", "5 seconds")
      expect(acquired).toBe(1)
      yield* sem.release(1)
    })
    await Effect.runPromise(program)
  })

  test("default timeout label stays human readable", () => {
    expect(SqlitePermitTimeoutLabel).toBe("30 seconds")
  })
})

describe("Bun SQLite client bounded acquirer", () => {
  test("still executes and serializes queries through the bounded permit path", async () => {
    const program = Effect.gen(function* () {
      const client = yield* Client.SqlClient
      const rows = yield* client.unsafe<{ n: number }>("SELECT 1 as n").withoutTransform
      expect(rows[0]?.n).toBe(1)

      // Regression guard for the acquirer rewrite: many concurrent statements must all
      // funnel through the single permit without deadlocking.
      const results = yield* Effect.forEach(
        Array.from({ length: 20 }, (_, index) => index),
        (index) => client.unsafe<{ n: number }>(`SELECT ${index} as n`).withoutTransform,
        { concurrency: 8 },
      )
      expect(results.map((rows) => rows[0]?.n)).toEqual(Array.from({ length: 20 }, (_, index) => index))
    })
    await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(sqliteLayer({ filename: ":memory:" })))))
  })

  test("transaction acquirer runs work through the bounded permit path", async () => {
    const program = Effect.gen(function* () {
      const client = yield* Client.SqlClient
      const result = yield* client.withTransaction(client.unsafe<{ n: number }>("SELECT 1 as n").withoutTransform)
      expect(result[0]?.n).toBe(1)
    })
    await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(sqliteLayer({ filename: ":memory:" })))))
  })
})
