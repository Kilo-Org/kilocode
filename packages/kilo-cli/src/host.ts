export * as KiloHost from "./host"

import { KiloPlugins, KiloPostPlugins, KiloRemote, KiloSandbox, KiloSessionSync } from "@kilocode/kilo-plugin"
import { PagesAuth } from "@kilocode/kilo-plugin/pages/auth"
import { PluginGitSource } from "@kilocode/kilo-plugin/plugin/git-source"
import { networkHttpLayer } from "@kilocode/sandbox"
import { Environment } from "@opencode/core/environment/index"
import { LayerNodePlatform as UtilPlatform } from "@opencode/util/effect/app-node-platform"
import { KiloRead } from "@kilocode/kilo-plugin/read"
import { App } from "@opencode/core/app"
import { Bus } from "@opencode/core/bus"
import { ConfigDiscovery } from "@opencode/core/config/discovery"
import { ConfigPluginSource } from "@opencode/core/config/plugin/source"
import { Flag } from "@opencode/core/flag"
import { ModelResolver } from "@opencode/core/model-resolver"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { KiloConfigDiscovery } from "@opencode/core/kilocode/config/discovery"
import { authFailure } from "@opencode/core/kilocode/mcp/auth-failure"
import { McpClientMetadata } from "@opencode/core/kilocode/mcp/client-metadata"
import { KiloSseProbe } from "@opencode/core/kilocode/mcp/sse-probe"
import { Model } from "@opencode/core/model"
import { Mcp } from "@opencode/core/mcp/index"
import { Schedule } from "@opencode/core/schedule"
import { SdkPlugins } from "@opencode/core/plugin/sdk"
import { Plugin } from "@opencode/core/plugin"
import { Session } from "@opencode/core/session"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { SessionProjector } from "@opencode/core/session/projector"
import { SessionStore } from "@opencode/core/session/store"
import { ToolOutput } from "@opencode/core/tool-output"
import { ReadToolFileSystem } from "@opencode/core/tool/read-filesystem"
import type { Plugin as PluginDefinition } from "@opencode/plugin/effect/plugin"
import { makeGlobalNode } from "@opencode/util/effect/app-node"
import { Npm } from "@opencode/util/npm"
import type { LayerNode } from "@opencode/util/effect/layer-node"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Context, Duration, Effect, Layer, type Scope } from "effect"
import { KiloApp } from "./app"
import { KiloGatewayErrors } from "./gateway-errors"
import { KiloPluginNpm } from "./plugin-npm"
import { KiloGatewayModel } from "./gateway-model"
import { KiloSessionRevert } from "./session-revert"
import { KiloSmallModel } from "./small-model"
import { SessionSync } from "./session-sync"
import { SessionSyncOutput } from "./session-sync/tool-output"
import { Remote } from "./remote"

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
      const services = Context.pick(
        Bus.Service,
        FSUtil.Service,
        Global.Service,
        Npm.Service,
        Schedule.Service,
        KiloSessionSync.Service,
        KiloRemote.Service,
        SessionStore.Service,
      )(
        yield* Effect.context<
          | Bus.Service
          | FSUtil.Service
          | Global.Service
          | Npm.Service
          | Schedule.Service
          | KiloSessionSync.Service
          | KiloRemote.Service
          | SessionStore.Service
        >(),
      )
      const register = (
        plugin: PluginDefinition<
          | Bus.Service
          | FSUtil.Service
          | Global.Service
          | Npm.Service
          | Schedule.Service
          | KiloSessionSync.Service
          | KiloRemote.Service
          | SessionStore.Service
          | Scope.Scope
        >,
        phase?: "post",
      ) =>
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
  deps: [Bus.node, FSUtil.node, Global.node, Npm.node, Schedule.node, SessionSync.node, Remote.node, SessionStore.node],
})

/**
 * The `OPENCODE_FLAGS` value the scheduler reads in Kilo. Scheduling is always on, except that a deliberate
 * `-schedules` entry stays an escape hatch so a release can stop unattended schedules without a new build.
 */
export function schedulingOverrides(overrides: string | undefined) {
  if (overrides?.split(",").some((flag) => flag.trim() === "-schedules")) return overrides
  return [overrides, "schedules"].filter(Boolean).join(",")
}

/**
 * Service replacements that the Kilo host gives the server it starts. `createRoutes` applies them after its
 * standard set, so they win: the Kilo plugins, Kilo's app identity and Kilo's config discovery (`kilo2.json`,
 * `.kilo2`, worktree boundary).
 */
export const overrides: LayerNode.Replacements = [
  LayerNodePlatform.llmClient.replace(LayerNodePlatform.llmClient.mapLayer(KiloGatewayErrors.layer)),
  SessionProjector.node.replace(SessionProjector.node.mapLayer(SessionSync.captureLayer)),
  ToolOutput.node.replace(SessionSyncOutput.node),
  // Read Office documents and notebooks as text through the native read tool (rung 2, service
  // replacement): upstream keeps ownership of the tool, its description, pages and instructions.
  ReadToolFileSystem.node.replace(KiloRead.node),
  SdkPlugins.node.replace(plugins),
  // `git:` plugin specs clone into a cache directory and load from there; npm and local path targets keep the
  // upstream loader. kilo_port(plugin:25cfde80052f)
  Plugin.node.replace(Plugin.configured({ pluginSource: PluginGitSource.pluginSource })),
  // The plugin update check and `plugin.update` see the same cache instead of asking npm about a `git:` spec.
  Npm.node.replace(KiloPluginNpm.node),
  // Kilo Plan mode (kilocode.plan) and the Kilo goal (kilocode.goal, which adds the agent's `goal` tool) replace the
  // native plugins: remove operations run before the config operations.
  ConfigPluginSource.node.replace(
    ConfigPluginSource.node.mapLayer((layer) =>
      Layer.effect(
        ConfigPluginSource.Service,
        Effect.gen(function* () {
          const source = yield* ConfigPluginSource.Service
          return {
            ...source,
            operations: () =>
              source.operations().pipe(
                Effect.map((operations) => [
                  { type: "remove" as const, target: "opencode.plan" },
                  { type: "remove" as const, target: "opencode.goal" },
                  // One scheduling surface: the wakeup plugin owns the wakeup and cron tools, so the native schedule
                  // tools (and their /schedule command) would only duplicate the prompt and the model's choice.
                  { type: "remove" as const, target: "opencode.tool.schedule" },
                  ...operations,
                ]),
              ),
          }
        }),
      ).pipe(Layer.provide(layer)),
    ),
  ),
  App.node.replace(App.configured(KiloApp)),
  // Scheduling is always on: the wakeup and Flow plugins own Kilo's schedules, so the scheduler reads
  // `experimental.schedules` as on whatever a config says. Only an explicit `-schedules` in OPENCODE_FLAGS turns it off
  // (see schedulingOverrides).
  Schedule.node.replace(
    Schedule.node.mapLayer((layer) =>
      layer.pipe(
        Layer.provide(
          Layer.effect(
            Flag.Overrides,
            Effect.gen(function* () {
              return schedulingOverrides(yield* Flag.Overrides)
            }),
          ),
        ),
      ),
    ),
  ),
  // MCP servers see the Kilo client identity, the hosted Kilo client document and its issuer binding, and a
  // non-SSE body on the optional GET stream probe is normalized so it cannot start a reconnect loop. The Pages wrapper
  // adds the Kilo bearer to the `pages` entry that the Pages plugin registers and to nothing else.
  // kilo_port(mcp:18028d867142)
  Mcp.node.replace(
    Mcp.configured({
      clientInfo: { name: "kilo", version: KiloApp.version },
      host: {
        oauth: McpClientMetadata.oauth,
        fetch: (base, endpoint) => PagesAuth.wrap(KiloSseProbe.probe(base, endpoint)),
        authFailure,
      },
    }),
  ),
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
  Session.node.replace(KiloSessionRevert.node),
  // kilo_port(unattributed:config:546539fc1643) kilo_port(unattributed:config:8cdbdec70393)
  ConfigDiscovery.node.replace(Layer.succeed(ConfigDiscovery.LayoutService, KiloConfigDiscovery.layout)),
  // A sandboxed tool call spawns, writes and sends HTTP requests inside its sandbox profile.
  // kilo_port(sandbox:b09868b61af4)
  Environment.node.replace(Environment.node.mapLayer(KiloSandbox.environment)),
  UtilPlatform.httpClient.replace(
    UtilPlatform.httpClient.mapLayer((layer) => networkHttpLayer.pipe(Layer.provide(layer))),
  ),
]
