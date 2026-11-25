import * as ModelsRefresh from "@opencode-ai/core/kilocode/models-refresh"
import { ModelCache } from "@/provider/model-cache"
import { KiloViewers } from "@/kilocode/presence/service"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Effect } from "effect"

export const disposeAllInstancesAfterProviderAuthCallback = Effect.fn(
  "KiloServer.disposeAllInstancesAfterProviderAuthCallback",
)(function* () {
  // Globally invalidate Provider.Service's ScopedCache even for worktrees
  // absent from InstanceStore.cache (e.g. repopulated by an in-flight request
  // after logout disposal), then dispose all loaded instances and emit global.disposed.
  yield* Effect.gen(function* () {
    yield* ModelsRefresh.notify()
    yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
  }).pipe(Effect.uninterruptible)
})

export const invalidatePresence = Effect.fn("KiloServer.invalidatePresence")(function* () {
  const viewers = yield* KiloViewers.Service
  yield* viewers.invalidateAuth()
})

export const invalidateAfterProviderAuthChange = Effect.fn("KiloServer.invalidateAfterProviderAuthChange")(function* (
  providerID: string,
) {
  const cache = yield* ModelCache.Service
  yield* cache.clear(providerID)
  yield* disposeAllInstancesAfterProviderAuthCallback()
})
