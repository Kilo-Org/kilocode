import { Cause, Context, Deferred, Effect, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { KiloSessionRetention } from "./retention"

export namespace KiloRetentionScheduler {
  const log = Log.create({ service: "session.retention.scheduler" })

  export class Service extends Context.Service<
    Service,
    {
      readonly start: (input?: { defer?: boolean }) => Effect.Effect<void>
      readonly stop: (drain?: boolean) => Effect.Effect<void>
    }
  >()("@kilocode/RetentionScheduler") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const config = yield* Config.Service
      const database = yield* Database.Service
      let deferred = false
      let recorded: KiloSessionRetention.State | undefined
      const pass = Effect.suspend(() => KiloSessionRetention.run({ reclaim: !deferred })).pipe(
        Effect.tap((outcome) =>
          Effect.sync(() => {
            if (outcome.ran) recorded = outcome.result
          }),
        ),
        Effect.asVoid,
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.sync(() => log.warn("scheduled retention failed", { cause: Cause.pretty(cause) })),
        ),
      )

      // Building AppLayer for utility commands must not start or drain cleanup.
      const opened = yield* Deferred.make<void>()
      const ready = yield* Deferred.make<void>()
      let pending: Fiber.Fiber<void> | undefined
      const loop = yield* Effect.gen(function* () {
        yield* Deferred.await(opened)
        pending = yield* pass.pipe(Effect.forkIn(scope, { startImmediately: true }))
        yield* Deferred.succeed(ready, undefined)
        while (true) {
          yield* Fiber.join(pending)
          yield* Effect.sleep("1 hour")
          pending = yield* pass.pipe(Effect.forkIn(scope))
        }
      }).pipe(Effect.forkIn(scope))

      const start = Effect.fn("KiloRetentionScheduler.start")(function* (input: { defer?: boolean } = {}) {
        if (!(yield* Deferred.isDone(opened))) deferred = input.defer === true
        yield* Deferred.succeed(opened, undefined)
        yield* Effect.raceFirst(Deferred.await(ready), Fiber.await(loop))
      })
      const stop = Effect.fn("KiloRetentionScheduler.stop")(function* (drain = false) {
        yield* Fiber.interrupt(loop)
        if (!pending) return
        if (drain) {
          // Exit must not wait for a long pass. Cancel stops between removals and keeps the partial result.
          KiloSessionRetention.cancel()
          yield* Fiber.await(pending)
          if (deferred && recorded && !recorded.cancelled)
            yield* KiloSessionRetention.recover(recorded).pipe(
              Effect.provideService(Config.Service, config),
              Effect.provideService(Database.Service, database),
            )
          return
        }
        yield* Fiber.interrupt(pending)
      })
      const off = KiloShutdown.register(() => Effect.runPromise(stop(true)))
      yield* Effect.addFinalizer(() => stop().pipe(Effect.ensuring(Effect.sync(off))))
      return Service.of({ start, stop })
    }),
  )

  export const node = LayerNode.make({
    service: Service,
    layer,
    deps: [Config.node, Database.node, Session.node],
  })
}
