import { InstanceState } from "@/effect/instance-state"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-layer"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Cause, Context, Effect, Layer, Scope } from "effect"

const log = Log.create({ service: "kilocode-watcher" })

export namespace KilocodeWatcher {
  export interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Watcher") {}

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap
      const scope = yield* Scope.Scope

      const state = yield* InstanceState.make(
        Effect.fn("KilocodeWatcher.state")(function* (ctx) {
          if (ctx.project.vcs !== "git") return
          // Warm the v2 location stack for this instance and hold it for the
          // instance lifetime. Its Watcher subscribes to .git so Vcs sees HEAD
          // changes and publishes vcs.branch.updated in the CLI, where no v2
          // route would otherwise build the stack. The ref must be built the
          // same way the file/pty handlers build theirs (Location.Ref.make) so
          // the LayerMap shares a single build per directory.
          const ref = Location.Ref.make({ directory: AbsolutePath.make(ctx.directory) })
          yield* locations.contextEffect(ref)
          // Tear the stack down with the instance instead of letting it idle
          // in the LayerMap; same pattern as the pty handlers' disposer.
          yield* Effect.addFinalizer(() => locations.invalidate(ref).pipe(Effect.ignore))
        }),
      )

      return Service.of({
        init: Effect.fn("KilocodeWatcher.init")(function* () {
          yield* InstanceState.get(state).pipe(
            Effect.catchCause((cause) =>
              Effect.sync(() => log.warn("instance watcher init failed", { err: Cause.squash(cause) })),
            ),
            Effect.forkIn(scope),
          )
        }),
      })
    }),
  )

  // Gate the whole layer so LocationServiceMap's dependency graph is never built when the watcher is disabled.
  export const defaultLayer = Layer.unwrap(
    Effect.gen(function* () {
      if (yield* Flag.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER.pipe(Effect.orElseSucceed(() => false)))
        return Layer.succeed(Service, Service.of({ init: () => Effect.void }))
      return layer.pipe(Layer.provide(LocationServiceMap.layer))
    }),
  )
}
