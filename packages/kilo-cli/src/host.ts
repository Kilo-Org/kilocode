export * as KiloHost from "./host"

import { KiloPlugins, KiloPostPlugins } from "@kilocode/kilo-plugin"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ModelResolver } from "@opencode/core/model-resolver"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { Model } from "@opencode/core/model"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import type { Plugin } from "@opencode/plugin/effect/plugin"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Context, Duration, Effect, Layer, type Scope } from "effect"
import { KiloApp } from "./app"
import { KiloGatewayErrors } from "./gateway-errors"
import { KiloGatewayModel } from "./gateway-model"
import { KiloSmallModel } from "./small-model"

/**
 * The duration in milliseconds of the last activation of each Kilo plugin, by plugin ID. The startup ratchet
 * (packages/kilo-cli/script/startup.ts) reads it; nothing at runtime does.
 */
export const activations = new Map<string, number>()

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
          {
            id: plugin.id,
            effect: (context) =>
              plugin.effect(context).pipe(
                Effect.provide(services),
                Effect.timed,
                Effect.map(([duration]) => {
                  activations.set(plugin.id, Duration.toMillis(duration))
                }),
              ),
          },
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
 * standard set, so they win: the Kilo plugins, Kilo's app identity and Kilo's config discovery (`kilo2.json`,
 * `.kilo2`, worktree boundary).
 */
export const overrides: LayerNode.Replacements = [
  LayerNodePlatform.llmClient.replace(LayerNodePlatform.llmClient.mapLayer(KiloGatewayErrors.layer)),
  SdkPlugins.node.replace(plugins),
  App.node.replace(App.configured(KiloApp)),
  Model.node.replace(
    Model.node.mapLayer((layer) =>
      Layer.effect(
        Model.Service,
        Effect.gen(function* () {
          const models = yield* Model.Service
          return { ...models, small: (providerID) => KiloSmallModel.select(models, providerID) }
        }),
      ).pipe(Layer.provide(layer)),
    ),
  ),
  ModelResolver.node.replace(KiloGatewayModel.resolverNode),
  SessionRunnerModel.node.replace(KiloGatewayModel.node),
  // kilo_port(unattributed:config:546539fc1643) kilo_port(unattributed:config:8cdbdec70393)
  ConfigDiscovery.node.replace(Layer.succeed(ConfigDiscovery.LayoutService, KiloConfigDiscovery.layout)),
]
