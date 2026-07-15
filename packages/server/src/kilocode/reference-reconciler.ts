import { Location } from "@opencode-ai/core/location"
import { PluginBoot } from "@opencode-ai/core/plugin/boot"
import { Reference } from "@opencode-ai/core/reference"
import { Context, Effect } from "effect"

export const ReferenceReconciler = Context.Reference<
  Effect.Effect<void, never, Location.Service | PluginBoot.Service | Reference.Service>
>("@kilocode/ReferenceReconciler", {
  defaultValue: () => Effect.void,
})

export function reconcile<A, E, R>(effect: Effect.Effect<A, E, R>) {
  return Effect.flatMap(ReferenceReconciler, (reconciler) => Effect.andThen(reconciler, effect))
}
