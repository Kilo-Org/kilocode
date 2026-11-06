export * as KiloRemote from "./remote"

import { define } from "@opencode/plugin/effect/plugin"
import { KiloRemoteRpc } from "@opencode/schema/kilocode/remote"
import { Context, Effect, type Scope } from "effect"

export interface Runtime {
  readonly status: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
  readonly enable: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
  readonly disable: () => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
  readonly attach: (sessionID: string) => Effect.Effect<KiloRemoteRpc.Status, KiloRemoteRpc.Failure>
}

interface Interface {
  readonly forDirectory: (directory: string) => Effect.Effect<Runtime, KiloRemoteRpc.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/Remote") {}

export const plugin = define<Service | Scope.Scope>({
  id: "kilocode.remote",
  effect: Effect.fn(function* (ctx) {
    const remote = yield* Service
    const runtime = () => remote.forDirectory(ctx.location.directory)
    yield* ctx.rpc
      .register(KiloRemoteRpc.Definition, {
        status: (_, context) =>
          runtime().pipe(
            Effect.flatMap((host) => host.status()),
            Effect.mapError((error) => context.error("failed", error.message, error)),
          ),
        enable: (_, context) =>
          runtime().pipe(
            Effect.flatMap((host) => host.enable()),
            Effect.mapError((error) => context.error("failed", error.message, error)),
          ),
        disable: (_, context) =>
          runtime().pipe(
            Effect.flatMap((host) => host.disable()),
            Effect.mapError((error) => context.error("failed", error.message, error)),
          ),
        attach: (input, context) =>
          runtime().pipe(
            Effect.flatMap((host) => host.attach(input.sessionID)),
            Effect.mapError((error) => context.error("failed", error.message, error)),
          ),
      })
      .pipe(Effect.orDie)
  }),
})
