export * as KiloRemote from "./remote"

import { define } from "@opencode/plugin/effect/plugin"
import { KiloRemoteRpc } from "@opencode/schema/kilocode/remote"
import { Context, Effect, type Scope } from "effect"

interface Interface {
  readonly status: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
  readonly enable: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
  readonly disable: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/Remote") {}

export const plugin = define<Service | Scope.Scope>({
  id: "kilocode.remote",
  effect: Effect.fn(function* (ctx) {
    const remote = yield* Service
    yield* ctx.rpc
      .register(KiloRemoteRpc.Definition, {
        status: (_, context) =>
          remote.status().pipe(Effect.mapError((error) => context.error("failed", error.message, error))),
        enable: (_, context) =>
          remote.enable().pipe(Effect.mapError((error) => context.error("failed", error.message, error))),
        disable: (_, context) =>
          remote.disable().pipe(Effect.mapError((error) => context.error("failed", error.message, error))),
      })
      .pipe(Effect.orDie)
  }),
})
