import { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { isInterrupted } from "@/kilocode/effect/cause"
import * as KiloReference from "@/kilocode/reference"
import { InstanceStore } from "@/project/instance-store"
import { Location } from "@opencode-ai/core/location"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { ReferenceReconciler } from "@opencode-ai/server/kilocode/reference-reconciler"
import { Effect, Layer } from "effect"

export const layer = Layer.effect(
  ReferenceReconciler,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const store = yield* InstanceStore.Service
    return Effect.gen(function* () {
      const location = yield* Location.Service
      const ctx = yield* store.load({ directory: location.directory })
      const cfg = yield* config.get().pipe(Effect.provideService(InstanceRef, ctx))
      yield* PluginBoot.Service.use((boot) => boot.wait())
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
  }),
)
