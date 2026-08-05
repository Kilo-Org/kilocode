import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

export const indexingHandlers = HttpApiBuilder.group(InstanceHttpApi, "indexing", (handlers) =>
  Effect.gen(function* () {
    const mod = yield* Effect.promise(() => import("@/kilocode/indexing"))
    const status = Effect.fn("IndexingHttpApi.status")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.KiloIndexing.current())
    })
    const consent = Effect.fn("IndexingHttpApi.consent")(function* (ctx: { payload: { enabled: boolean } }) {
      yield* EffectBridge.fromPromise(() => mod.KiloIndexing.setConsent(ctx.payload.enabled))
      return yield* EffectBridge.fromPromise(() => mod.KiloIndexing.current())
    })
    const models = Effect.fn("IndexingHttpApi.models")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.KiloIndexing.models())
    })
    const warnings = Effect.fn("IndexingHttpApi.warnings")(function* () {
      return yield* EffectBridge.fromPromise(() => mod.KiloIndexing.warnings())
    })

    return handlers
      .handle("status", status)
      .handle("consent", consent)
      .handle("models", models)
      .handle("warnings", warnings)
  }),
)
