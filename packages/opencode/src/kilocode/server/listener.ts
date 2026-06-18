import { AppLayer } from "@/effect/app-runtime"
import { memoMap } from "@opencode-ai/core/effect/memo-map"
import { Layer, Scope } from "effect"

export function build<A, E, R>(layer: Layer.Layer<A, E, R>, scope: Scope.Scope) {
  // Keep listener transport state fresh while AppLayer reuses the process-wide services.
  return Layer.buildWithMemoMap(Layer.fresh(layer).pipe(Layer.provide(AppLayer)), memoMap, scope)
}
