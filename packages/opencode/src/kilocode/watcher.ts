import { InstanceState } from "@/effect/instance-state"
import { registerDisposer } from "@/effect/instance-registry"
import type { InstanceContext } from "@/project/instance-context"
import * as Log from "@opencode-ai/core/util/log"
import { Flag } from "@opencode-ai/core/flag/flag"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap, locationServiceMapLayer } from "@opencode-ai/core/location-services"
import { AbsolutePath } from "@opencode-ai/core/schema"
import { Cause, Context, Effect, Exit, Layer, Scope } from "effect"

const log = Log.create({ service: "kilocode-watcher" })

export namespace KilocodeWatcher {
  export interface Interface {
    readonly init: () => Effect.Effect<void>
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/Watcher") {}

  // Embedded editor clients (VS Code, JetBrains) have their own file watching
  // and git integration and do not consume the CLI's vcs.branch.updated event,
  // so they must not eagerly warm the location stack. The standalone CLI/TUI
  // keeps this subscription for live branch-label updates.
  export function eager(client = Flag.KILO_CLIENT) {
    return client !== "vscode" && client !== "jetbrains"
  }

  export const layer = Layer.effect(
    Service,
    Effect.gen(function* () {
      const locations = yield* LocationServiceMap.Service
      const scope = yield* Scope.Scope
      const active = new Map<string, Scope.Closeable>()
      const ref = (directory: string) => Location.Ref.make({ directory: AbsolutePath.make(directory) })

      const off = registerDisposer((directory) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const child = active.get(directory)
            if (child) {
              active.delete(directory)
              yield* Scope.close(child, Exit.void)
            }
            yield* locations.invalidate(ref(directory))
          }).pipe(Effect.ignore),
        ),
      )
      yield* Effect.addFinalizer(() => Effect.sync(off))
      yield* Effect.addFinalizer(() =>
        Effect.forEach(active.values(), (child) => Scope.close(child, Exit.void), { discard: true }).pipe(
          Effect.andThen(Effect.sync(() => active.clear())),
        ),
      )

      const warm = (ctx: InstanceContext, child: Scope.Closeable) =>
        Scope.provide(child)(locations.contextEffect(ref(ctx.directory)))

      return Service.of({
        init: Effect.fn("KilocodeWatcher.init")(function* () {
          const ctx = yield* InstanceState.context
          if (ctx.project.vcs !== "git" || active.has(ctx.directory)) return

          const child = yield* Scope.make()
          active.set(ctx.directory, child)
          yield* warm(ctx, child).pipe(
            Effect.catchCause((cause) =>
              Effect.gen(function* () {
                if (active.get(ctx.directory) === child) active.delete(ctx.directory)
                yield* Scope.close(child, Exit.void).pipe(Effect.ignore)
                yield* Effect.sync(() => log.warn("instance watcher init failed", { err: Cause.squash(cause) }))
              }),
            ),
            Effect.forkIn(scope, { startImmediately: true }),
          )
        }),
      })
    }),
  )

  // Gate the whole layer so LocationServiceMap is only warmed for clients that consume branch-update events.
  export const defaultLayer = Layer.unwrap(
    Effect.gen(function* () {
      if (!eager() || (yield* Flag.KILO_EXPERIMENTAL_DISABLE_FILEWATCHER.pipe(Effect.orElseSucceed(() => false))))
        return Layer.succeed(Service, Service.of({ init: () => Effect.void }))
      return layer.pipe(Layer.provide(locationServiceMapLayer))
    }),
  )
}
