import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { EffectBridge } from "@/effect/bridge"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"

export const indexingHandlers = HttpApiBuilder.group(InstanceHttpApi, "indexing", (handlers) =>
  Effect.gen(function* () {
    const status = Effect.fn("IndexingHttpApi.status")(function* () {
      const mod = yield* Effect.promise(() => import("@/kilocode/indexing"))
      const current = yield* EffectBridge.fromPromise(() => mod.KiloIndexing.current())
      return current
    })

    return handlers.handle("status", status)
  }),
)
