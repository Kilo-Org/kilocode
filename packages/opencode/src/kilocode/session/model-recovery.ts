import { Effect } from "effect"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"

export namespace KiloModelRecovery {
  export type Candidate = {
    providerID: ProviderV2.ID
    modelID: ModelV2.ID
    variant?: string
  }

  /**
   * Sessions remember the model they were last prompted with. When the live catalog drops that
   * ID - a Kilo Gateway slug is retired, an org loses access - the remembered ID is dead and
   * re-sending it only fails downstream. Return the first candidate the catalog still has so the
   * caller can fall back to a valid default instead of prompting with a stale ID forever.
   */
  export const firstAvailable = <A, E, R>(
    candidates: readonly Candidate[],
    lookup: (model: Candidate) => Effect.Effect<A, E, R>,
  ): Effect.Effect<Candidate | undefined, never, R> =>
    Effect.gen(function* () {
      for (const candidate of candidates) {
        const found = yield* lookup(candidate).pipe(Effect.catch(() => Effect.succeed(undefined)))
        if (found !== undefined) return candidate
      }
      return undefined
    })
}
