import { Effect } from "effect"
import { Provider } from "@/provider/provider"
import type { AutonomousConfig } from "./config"
import type { AutonomousState } from "./state"

/** Resolve the three model classes to concrete provider/model ids. No ids are hard-coded. */
export namespace AutonomousModels {
  export type Ref = { providerID: string; modelID: string }
  export type Map = Record<AutonomousState.ModelClass, Ref>

  export const parse = (value: string): Ref => {
    const parsed = Provider.parseModel(value)
    return { providerID: String(parsed.providerID), modelID: String(parsed.modelID) }
  }

  export const format = (ref: Ref) => `${ref.providerID}/${ref.modelID}`

  export const cloud = (ref: Ref) => ref.providerID

  /**
   * Fallback chain per class:
   *   local-small    → models.local_small    → small_model    → subagent_model → model → default
   *   local-coder    → models.local_coder    → subagent_model → model          → default
   *   cloud-reasoner → models.cloud_reasoner → model          → default
   */
  export const resolve = Effect.fn("AutonomousModels.resolve")(function* (input: {
    autonomous: AutonomousConfig.Info
    config: { model?: string; small_model?: string; subagent_model?: string }
  }) {
    const provider = yield* Provider.Service
    const fallback = yield* provider.defaultModel()
    const base: Ref = { providerID: String(fallback.providerID), modelID: String(fallback.modelID) }
    const pick = (...candidates: (string | undefined)[]) => {
      const hit = candidates.find((c) => typeof c === "string" && c.trim().length > 0)
      return hit ? parse(hit) : base
    }
    const m = input.autonomous.models
    const c = input.config
    return {
      "local-small": pick(m.local_small, c.small_model, c.subagent_model, c.model),
      "local-coder": pick(m.local_coder, c.subagent_model, c.model),
      "cloud-reasoner": pick(m.cloud_reasoner, c.model),
    } satisfies Map
  })

  /** Pure variant used by tests and the router when a default is already known. */
  export function resolveWith(input: {
    autonomous: AutonomousConfig.Info
    config: { model?: string; small_model?: string; subagent_model?: string }
    fallback: Ref
  }): Map {
    const pick = (...candidates: (string | undefined)[]) => {
      const hit = candidates.find((c) => typeof c === "string" && c.trim().length > 0)
      return hit ? parse(hit) : input.fallback
    }
    const m = input.autonomous.models
    const c = input.config
    return {
      "local-small": pick(m.local_small, c.small_model, c.subagent_model, c.model),
      "local-coder": pick(m.local_coder, c.subagent_model, c.model),
      "cloud-reasoner": pick(m.cloud_reasoner, c.model),
    }
  }
}
