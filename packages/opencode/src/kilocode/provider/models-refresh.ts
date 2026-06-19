import { Effect, ScopedCache } from "effect"
import * as Refresh from "@opencode-ai/core/kilocode/models-refresh"
import type { InstanceState } from "@/effect/instance-state"
import { ModelCache } from "@/provider/model-cache"
import { ModelsDev } from "@/provider/models"

export const watch = <A, E, R>(state: InstanceState<A, E, R>) =>
  Refresh.watch(() => ScopedCache.invalidateAll(state.cache))

export const refresh = Effect.fn("ModelsRefresh.refresh")(function* (
  models: ModelsDev.Interface,
  cache: ModelCache.Interface,
) {
  yield* models.refresh(true)
  yield* cache.refresh("kilo")
  yield* Refresh.notify()
})
