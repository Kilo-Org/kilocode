import { Cause, Context, Effect, Fiber, Layer, Scope } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Database } from "@opencode-ai/core/database/database"
import * as Log from "@opencode-ai/core/util/log"
import { Config } from "@/config/config"
import { Session } from "@/session/session"
import { KiloShutdown } from "@/kilocode/cli/shutdown"
import { KiloSessionRetention } from "./retention"

export namespace KiloRetentionScheduler {
  const log = Log.create({ service: "session.retention.scheduler" })

  export class Service extends Context.Service<Service, { readonly stop: (drain?: boolean) => Effect.Effect<void> }>()(
    "@kilocode/RetentionScheduler",
  ) {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const config = yield* Config.Service
      const pass = Effect.gen(function* () {
        const active = KiloSessionRetention.policy(yield* config.getGlobal())
        if (!KiloSessionRetention.shouldRun(active, {}, yield* KiloSessionRetention.readState(), Date.now()).ok) return
        yield* KiloSessionRetention.run()
      }).pipe(
        Effect.catchCause((cause) =>
          Cause.hasInterrupts(cause)
            ? Effect.interrupt
            : Effect.sync(() => log.warn("scheduled retention failed", { cause })),
        ),
      )

      // Keep the pass separate from the timer so normal CLI exit can drain it.
      let pending = yield* pass.pipe(Effect.forkIn(scope, { startImmediately: true }))
      const loop = yield* Effect.gen(function* () {
        while (true) {
          yield* Fiber.join(pending)
          yield* Effect.sleep("1 hour")
          pending = yield* pass.pipe(Effect.forkIn(scope))
        }
      }).pipe(Effect.forkIn(scope))

      const stop = Effect.fn("KiloRetentionScheduler.stop")(function* (drain = false) {
        yield* Fiber.interrupt(loop)
        if (drain) {
          yield* Fiber.await(pending)
          return
        }
        yield* Fiber.interrupt(pending)
      })
      const off = KiloShutdown.register(() => Effect.runPromise(stop(true)))
      yield* Effect.addFinalizer(() => stop().pipe(Effect.ensuring(Effect.sync(off))))
      return Service.of({ stop })
    }),
  )

  export const node = LayerNode.make({
    service: Service,
    layer,
    deps: [Config.node, Database.node, Session.node],
  })
}
