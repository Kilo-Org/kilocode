import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { isInterrupted } from "@/kilocode/effect/cause"
import * as KiloReference from "@/kilocode/reference"
import { InstanceStore } from "@/project/instance-store"
import { LocationServiceMap } from "@opencode-ai/core/location-services"
import { Location } from "@opencode-ai/core/location"
import { PluginV2 } from "@opencode-ai/core/plugin" // kilocode_change
import { ReferenceReconciler } from "@opencode-ai/server/kilocode/reference-reconciler"
import { Effect, Layer } from "effect"

const reconcile = Effect.gen(function* () {
  const config = yield* Config.Service
  const store = yield* InstanceStore.Service
  return Effect.gen(function* () {
    const location = yield* Location.Service
    const ctx = yield* store.load({ directory: location.directory })
    const cfg = yield* config.get().pipe(Effect.provideService(InstanceRef, ctx))
    yield* (yield* PluginV2.Service).wait(PluginV2.ID.make("core/config-reference")) // kilocode_change
    yield* KiloReference.sync({
      references: cfg.references ?? cfg.reference ?? {},
      directory: ctx.directory,
      worktree: ctx.worktree,
    }).pipe(
      Effect.catchCause((cause) =>
        isInterrupted(cause) ? Effect.interrupt : Effect.logWarning("reference sync failed", { cause }),
      ),
    )
  })
})

export const layer = Layer.effect(ReferenceReconciler, reconcile)
export const locations = Layer.effect(
  LocationServiceMap.Service,
  Effect.gen(function* () {
    const locations = yield* LocationServiceMap.Service
    const initialize = yield* reconcile
    return LocationServiceMap.Service.of({
      ...locations,
      get: (ref) => Layer.effectDiscard(initialize).pipe(Layer.provideMerge(locations.get(ref))),
      contextEffect: (ref) =>
        Effect.gen(function* () {
          const context = yield* locations.contextEffect(ref)
          yield* initialize.pipe(Effect.provide(context))
          return context
        }),
    })
  }),
)
