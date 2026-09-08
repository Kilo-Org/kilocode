import { Effect, Exit, Fiber, Latch, Scope } from "effect"

export namespace KiloRunner {
  export type Started = {
    fiber: Fiber.Fiber<unknown, unknown>
    ready: Latch.Latch
  }

  export const guard = <A, E, R>(
    current: (fiber: Fiber.Fiber<unknown, unknown>) => boolean,
    work: (record: (started: Started) => void) => Effect.Effect<A, E, R>,
  ) =>
    Effect.suspend(() => {
      let started: Started | undefined
      return work((value) => {
        started = value
      }).pipe(
        Effect.onExit(() => {
          if (!started) return Effect.void
          return current(started.fiber) ? started.ready.open : Fiber.interrupt(started.fiber)
        }),
      )
    })

  export const fork = <A, E>(work: Effect.Effect<Fiber.Fiber<A, E>>, lease?: Effect.Effect<() => void>) =>
    Effect.gen(function* () {
      const release = yield* lease ?? Effect.succeed(() => {})
      const fiber = yield* work.pipe(Effect.onError(() => Effect.sync(release)))
      fiber.addObserver(release)
      return fiber
    }).pipe(Effect.uninterruptible)

  export const start = <A, E, R>(input: {
    work: Effect.Effect<A, E>
    scope: Scope.Scope
    lease?: Effect.Effect<() => void>
    record: (started: Started) => void
    finish: (exit: Exit.Exit<A, E>) => Effect.Effect<void>
    handle: (fiber: Fiber.Fiber<A, E>) => R
  }) =>
    Effect.gen(function* () {
      const ready = yield* Latch.make()
      const fiber = yield* fork(
        ready
          .whenOpen(input.work)
          .pipe(Effect.onExit(input.finish), Effect.forkIn(input.scope, { uninterruptible: false })),
        input.lease,
      )
      input.record({ fiber, ready })
      return { run: input.handle(fiber), ready }
    }).pipe(Effect.uninterruptible)

  export const commit = <A, E, R>(start: Effect.Effect<{ run: R; ready: Latch.Latch }>, after: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const started = yield* start
      return [
        started.ready.open.pipe(Effect.uninterruptible, Effect.andThen(after)),
        { _tag: "Running", run: started.run } as const,
      ] as const
    })
}
