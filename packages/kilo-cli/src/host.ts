export * as KiloHost from "./host"

import { KiloPlugins } from "@kilocode/kilo-plugin"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Effect, Layer } from "effect"
import { KiloApp } from "./app"

// The server's SdkPlugins store with the Kilo plugins registered, the seam upstream offers to embedders. The
// plugin loader gives a registered plugin only its Scope, so the host provides the global services that a Kilo
// plugin requires (the Gateway publishes on the global Bus). It is the same Bus the store itself uses.
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const bus = yield* Bus.Service
      yield* Effect.forEach(KiloPlugins, (plugin) =>
        sdk.register({
          id: plugin.id,
          effect: (context) => plugin.effect(context).pipe(Effect.provideService(Bus.Service, bus)),
        }),
      )
    }),
  ).pipe(Layer.provideMerge(SdkPlugins.layer)),
  deps: [Bus.node],
})

/**
 * Service replacements that the Kilo host gives the server it starts. `createRoutes` applies them after its
 * standard set, so they win: the Kilo plugins and Kilo's app identity.
 */
export const overrides: LayerNode.Replacements = [
  SdkPlugins.node.replace(plugins),
  App.node.replace(App.configured(KiloApp)),
]
