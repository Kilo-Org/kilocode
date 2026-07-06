import { Effect, Exit, Fiber, Latch, Scope } from "effect"

export namespace KiloRunner {
  export const start = <A, E, R>(input: {
    work: Effect.Effect<A, E>
    scope: Scope.Scope
    finish: (exit: Exit.Exit<A, E>) => Effect.Effect<void>
    handle: (fiber: Fiber.Fiber<A, E>) => R
  }) =>
    Effect.gen(function* () {
      const ready = yield* Latch.make()
      const fiber = yield* ready.whenOpen(input.work).pipe(Effect.onExit(input.finish), Effect.forkIn(input.scope))
      return { run: input.handle(fiber), ready }
    })

  export const commit = <A, E, R>(start: Effect.Effect<{ run: R; ready: Latch.Latch }>, after: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const started = yield* start
      return [
        started.ready.open.pipe(Effect.uninterruptible, Effect.andThen(after)),
        { _tag: "Running", run: started.run } as const,
      ] as const
    })
}
