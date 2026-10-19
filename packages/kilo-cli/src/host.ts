export * as KiloHost from "./host"

import { KiloPlugins, KiloPostPlugins } from "@kilocode/kilo-plugin"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Effect, Layer, type Scope } from "effect"
import { KiloApp } from "./app"

// The server's SdkPlugins store with the Kilo plugins registered, the seam upstream offers to embedders. The
// plugin loader gives a registered plugin only its Scope, so the host provides the global services that a Kilo
// plugin requires: the Gateway publishes on the global Bus, the agents read the Global paths. They are the
// services of the server's own graph.
const plugins = makeGlobalNode({
  service: SdkPlugins.Service,
  layer: Layer.effectDiscard(
    Effect.gen(function* () {
      const sdk = yield* SdkPlugins.Service
      const services = Context.pick(Bus.Service, Global.Service)(yield* Effect.context<Bus.Service | Global.Service>())
      const register = (plugin: Plugin<Bus.Service | Global.Service | Scope.Scope>, phase?: "post") =>
        sdk.register(
          { id: plugin.id, effect: (context) => plugin.effect(context).pipe(Effect.provide(services)) },
          { phase },
        )
      yield* Effect.forEach(KiloPlugins, (plugin) => register(plugin))
      yield* Effect.forEach(KiloPostPlugins, (plugin) => register(plugin, "post"))
    }),
  ).pipe(Layer.provideMerge(SdkPlugins.layer)),
  deps: [Bus.node, Global.node],
})

/**
 * Service replacements that the Kilo host gives the server it starts. `createRoutes` applies them after its
 * standard set, so they win: the Kilo plugins and Kilo's app identity.
 */
export const overrides: LayerNode.Replacements = [
  SdkPlugins.node.replace(plugins),
  App.node.replace(App.configured(KiloApp)),
]
