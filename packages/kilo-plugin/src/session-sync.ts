export * as KiloSessionSync from "./session-sync"

import { define } from "@opencode/plugin/effect/plugin"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { Context, Effect, type Scope } from "effect"

interface EnableInput {
  directory: string
  organizationID: string | null
  assets?: readonly string[]
}

interface Interface {
  readonly enable: (input: EnableInput) => Effect.Effect<KiloSessionSyncRpc.Status, KiloSessionSyncRpc.Failure>
  readonly disable: (input: {
    directory: string
  }) => Effect.Effect<KiloSessionSyncRpc.Status, KiloSessionSyncRpc.Failure>
  readonly status: (input: {
    directory: string
  }) => Effect.Effect<KiloSessionSyncRpc.Status, KiloSessionSyncRpc.Failure>
  readonly flush: (input: { directory: string }) => Effect.Effect<KiloSessionSyncRpc.Status, KiloSessionSyncRpc.Failure>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/SessionSync") {}

export const plugin = define<Service | Scope.Scope>({
  id: "kilocode.session-sync",
  effect: Effect.fn(function* (ctx) {
    const sync = yield* Service
    // Enroll this location before its first native write; untouched existing history stays local.
    yield* sync.status({ directory: ctx.location.directory }).pipe(
      Effect.catch((error) => Effect.logWarning("Session synchronization enrollment is paused", { code: error.code })),
    )
    yield* ctx.rpc
      .register(KiloSessionSyncRpc.Definition, {
        enable: (input, context) =>
          sync
            .enable(input)
            .pipe(
              Effect.mapError((error) =>
                context.error("failed", error.message, { code: error.code, message: error.message }),
              ),
            ),
        disable: (input, context) =>
          sync
            .disable(input)
            .pipe(
              Effect.mapError((error) =>
                context.error("failed", error.message, { code: error.code, message: error.message }),
              ),
            ),
        status: (input, context) =>
          sync
            .status(input)
            .pipe(
              Effect.mapError((error) =>
                context.error("failed", error.message, { code: error.code, message: error.message }),
              ),
            ),
        flush: (input, context) =>
          sync
            .flush(input)
            .pipe(
              Effect.mapError((error) =>
                context.error("failed", error.message, { code: error.code, message: error.message }),
              ),
            ),
      })
      .pipe(Effect.orDie)
  }),
})
