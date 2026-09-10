import { NodeFileSystem, NodeHttpServer } from "@effect/platform-node"
import { createGatewayPlugin, type GatewayOptions } from "@kilocode/gateway"
import type { Plugin } from "@opencode-ai/plugin/effect/plugin"
import { SdkPlugins } from "@opencode-ai/core/plugin/sdk"
import { Config } from "@opencode-ai/core/config"
import { Bus } from "@opencode-ai/core/bus"
import { Event } from "@opencode-ai/schema/config"
import { Credential } from "@opencode-ai/core/credential"
import { Database } from "@opencode-ai/core/database/database"
import { Location } from "@opencode-ai/core/location"
import { LocationServiceMap } from "@opencode-ai/core/location-service-map"
import { Session } from "@opencode-ai/core/session"
import { Instance } from "@opencode-ai/core/instance/service"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { SessionRestart } from "@opencode-ai/core/session/execution/restart"
import { SessionTransfer } from "@opencode-ai/core/session/transfer"
import { hasPtyConnectTicketURL } from "@opencode-ai/protocol/groups/pty"
import { hasPersistentPtyConnectTicketURL } from "@opencode-ai/protocol/groups/persistent-pty"
import { authorizedRequest } from "@opencode-ai/server/middleware/authorization"
import { createRoutes } from "@opencode-ai/server/routes"
import { Flock } from "@opencode-ai/util/flock"
import { FSUtil } from "@opencode-ai/util/fs-util"
import { Global } from "@opencode-ai/util/global"
import { Context, Effect, Layer, Logger, Option, References } from "effect"
import { HttpPlatform, HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { createServer } from "node:http"
import path from "node:path"
import { credential } from "./auth"
import { createCredentialImporter } from "./credential-import"
import { createBoardNoticeGuard, createToolAuthorizer } from "./tool-authorization"
import { profile } from "./host"
import { preflight, type Layout } from "./paths"
import { prepare } from "./storage"
import { createReviewPolicy } from "./review-policy"
import { createAgentPolicy, createExplorePolicy, agentPolicyPhase } from "./agent-policy"
import { createPlanPolicy } from "./plan-policy"
import { createRoutedModelPlugin } from "./routed-model-plugin"
import { createModelPromptPolicy } from "./model-prompt-policy"
import { readDataCollectionPolicy } from "./request-policy"
import { createMemoryPlugin } from "./memory-plugin"
import { createMemoryDiffReader } from "./memory-diff"
import { createSessionFamilyUsageReader } from "./session-usage"
import { createSessionUsagePlugin } from "./session-usage-plugin"
import { createDisabledIndexingPlugin } from "./indexing-disabled"
import { createSettingsPlugin } from "./settings"
import { createGenerationPlugin } from "./generation-plugin"
import { createModelStatePlugin } from "./model-state-plugin"
import { createPrivacyPlugin } from "./privacy"
import { createSkillPolicy } from "./skill-policy"
import { createSkillShell } from "./skill-shell"
import type { TelemetryConfig } from "./telemetry"
import type { IndexingConfig } from "@kilocode/indexing/config"
import type { CloudServiceOrigins } from "./cloud-plugin"
import { createSandboxPlugin, type SandboxConfig } from "./sandbox"

export function launch(
  input: Layout,
  options: {
    plugins?: readonly Plugin[]
    models?: boolean
    content?: string
    gateway?: GatewayOptions
    recover?: boolean
    telemetry?: TelemetryConfig
    persistedTelemetry?: boolean
    sandbox?: SandboxConfig
    projectConfig?: boolean
    indexing?: IndexingConfig
    swarm?: boolean
    disableSkillShell?: boolean
    cloud?: CloudServiceOrigins & { allowHttpLoopback?: boolean }
    remote?: { relayURL: string; allowHttpLoopback?: boolean }
    lock?: Pick<Flock.Options, "staleMs" | "timeoutMs">
  } = {},
) {
  return Effect.gen(function* () {
    if (input.channel !== "interactive")
      throw new Error("The conversation host requires the isolated interactive profile")
    preflight(input)
    Flock.setGlobal({ state: input.paths.state })
    yield* Flock.effect("kilo2-interactive", {
      dir: path.join(input.paths.state, "locks"),
      staleMs: options.lock?.staleMs,
      timeoutMs: options.lock?.timeoutMs ?? 90000,
      onWait: (event) => {
        if (event.attempt === 1)
          console.error(
            "Waiting for the interactive store lock; another instance may be running or recovering. Ctrl-C cancels.",
          )
      },
    })
    prepare(input)
    process.env.OPENCODE_PTY_RUNTIME_DIR = input.pty
    const password = credential(input.password)
    const auth = { username: "opencode", password: Option.some(password) }
    const configured = profile(input, {
      models: options.models ?? true,
      content: options.content,
      projectConfig: options.projectConfig,
      sandbox: options.sandbox,
    })
    const listener = createServer({ requestTimeout: 10000, headersTimeout: 5000, connectionsCheckingInterval: 1000 })
    const urls = () => {
      const address = listener.address()
      return address && typeof address !== "string" ? [`http://127.0.0.1:${address.port}`] : []
    }
    const context = yield* Layer.build(
      createRoutes({ ...configured.options, password }, urls, configured.overrides).pipe(
        Layer.provideMerge(NodeHttpServer.layerHttpServices),
      ),
    )
    const plugins = Context.get(context, SdkPlugins.Service)
    const toolServices = {
      sessions: Context.get(context, Session.Service),
      instances: Context.get(context, Instance.Service),
      saved: Context.get(context, PermissionSaved.Service),
    }
    const authorize = createToolAuthorizer(toolServices)
    yield* plugins.register(
      createSessionUsagePlugin({
        read: createSessionFamilyUsageReader(Context.get(context, Database.Service)),
      }),
    )
    const skillFiles = yield* FSUtil.Service.pipe(Effect.provide(FSUtil.layer), Effect.provide(NodeFileSystem.layer))
    yield* plugins.register(createReviewPolicy())
    // Default SDK phase follows native agents and precedes user config overlays.
    yield* plugins.register(createExplorePolicy())
    yield* plugins.register(
      createMemoryPlugin({
        data: input.paths.data,
        authorize,
        readSnapshotDiff: createMemoryDiffReader(toolServices),
      }),
    )
    if (!options.indexing) yield* plugins.register(createDisabledIndexingPlugin())
    const configLocations = Context.get(context, LocationServiceMap.Service)
    yield* plugins.register(
      createSettingsPlugin({
        layout: input,
        project: options.projectConfig,
        refresh: (location) =>
          Effect.gen(function* () {
            const config = yield* Config.Service
            if (!config.reload) return yield* Effect.fail(new Error("Configuration refresh is unavailable"))
            yield* config.reload()
            // Skill/agent files can change without changing their config discovery roots.
            if (!options.projectConfig) {
              const bus = yield* Bus.Service
              yield* bus.publish(Event.Updated, {})
            }
          }).pipe(Effect.provide(configLocations.get(location))),
      }),
    )
    yield* plugins.register(createGenerationPlugin())
    yield* plugins.register(createModelStatePlugin(input.paths.state))
    yield* plugins.register(createPrivacyPlugin({ layout: input }))
    if (options.swarm) {
      const { OpenCode } = yield* Effect.promise(() => import("@opencode-ai/client"))
      const { createSwarmPlugin } = yield* Effect.promise(() => import("./swarm"))
      yield* plugins.register(
        createSwarmPlugin({
          enabled: true,
          client: () =>
            OpenCode.make({ baseUrl: urls()[0], headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` } }),
          authorize,
          canReadNotice: createBoardNoticeGuard(toolServices),
        }),
      )
    }
    if (options.indexing) {
      const { createIndexingPlugin } = yield* Effect.promise(() => import("./indexing"))
      yield* plugins.register(createIndexingPlugin({ state: input.paths.state, settings: options.indexing, authorize }))
    }
    for (const plugin of options.plugins ?? []) yield* plugins.register(plugin)
    yield* plugins.register(createAgentPolicy(), { phase: agentPolicyPhase })
    yield* plugins.register(createPlanPolicy({ authorize }), { phase: "post" })
    if (options.sandbox?.enabled) yield* plugins.register(createSandboxPlugin(options.sandbox), { phase: "post" })
    yield* plugins.register(
      createSkillPolicy({
        skillShell: createSkillShell({
          layout: input,
          sessions: toolServices.sessions,
          instances: toolServices.instances,
          global: Context.get(context, Global.Service),
          fs: skillFiles,
          profileContent: options.content,
          disabled: options.disableSkillShell ?? ["1", "true"].includes(process.env.KILO_DISABLE_SKILL_SHELL ?? ""),
        }),
      }),
      { phase: "post" },
    )
    if (options.gateway) {
      const promptReaders = new Map<string, (modelID: string) => string | undefined>()
      const promptLocationKey = (location: Location.Ref) =>
        JSON.stringify([location.directory, location.workspaceID ?? null])
      const transfer = Context.get(context, SessionTransfer.Service)
      const locations = Context.get(context, LocationServiceMap.Service)
      const { registerCloud } = yield* Effect.promise(() => import("./cloud-plugin"))
      const { registerRemote } = yield* Effect.promise(() => import("./remote-plugin"))
      const { OpenCode } = yield* Effect.promise(() => import("@opencode-ai/client"))
      const { DEFAULT_CLOUD_AGENT_ORIGIN, DEFAULT_WEB_APP_ORIGIN } = yield* Effect.promise(
        () => import("./cloud/origin"),
      )
      yield* plugins.register(
        createGatewayPlugin(
          {
            ...options.gateway,
            promptSelector: {
              register: (location, read) =>
                Effect.gen(function* () {
                  const key = promptLocationKey(location)
                  promptReaders.set(key, read)
                  yield* Effect.addFinalizer(() =>
                    Effect.sync(() => {
                      if (promptReaders.get(key) === read) promptReaders.delete(key)
                    }),
                  )
                }),
            },
            // Bridge the location-scoped Config service to the Gateway so explicit configured
            // model fields win over API catalog enrichment (the plugin Context cannot reach it).
            configEntries: (location) =>
              Effect.flatMap(Config.Service, (config) => config.entries()).pipe(
                Effect.provide(locations.get(location)),
              ),
            // Bridge the raw Kilo-only settings fold so an explicit
            // `hide_prompt_training_models: true` requests data-collection denial on Gateway
            // request bodies. False, unset, invalid, or unreadable values request nothing.
            dataCollectionPolicy: (location) =>
              Effect.flatMap(Location.Service, (resolved) =>
                readDataCollectionPolicy({ layout: input, project: options.projectConfig === true }, resolved),
              ).pipe(Effect.provide(locations.get(location))),
          },
          { import: transfer.import },
          (ctx, account) =>
            Effect.gen(function* () {
              yield* registerCloud(
                options.cloud ?? {
                  agentOrigin: DEFAULT_CLOUD_AGENT_ORIGIN,
                  webAppOrigin: DEFAULT_WEB_APP_ORIGIN,
                },
                { allowHttpLoopback: options.cloud?.allowHttpLoopback },
              )(ctx, account)
              yield* registerRemote({
                // Source: ecccd1f kilo-sessions/kilo-sessions.ts remoteEnable.
                // Registration is inert; only an explicit authenticated RPC enables it.
                relayURL: options.remote?.relayURL ?? "https://ingest.kilosessions.ai",
                allowHttpLoopback: options.remote?.allowHttpLoopback,
                client: () =>
                  OpenCode.make({
                    baseUrl: urls()[0],
                    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
                  }),
              })(ctx, account)
            }),
        ),
        { phase: "post" },
      )
      yield* plugins.register(
        createModelPromptPolicy({
          selector: (location, model) => promptReaders.get(promptLocationKey(location))?.(model.id),
        }),
        { phase: "post" },
      )
    }
    // Catalog discovery must run first: Gateway can add API-only Auto models.
    yield* plugins.register(createRoutedModelPlugin(), { phase: "post" })
    const http = yield* NodeHttpServer.make(() => listener, { host: "127.0.0.1", port: 0 })
    yield* Effect.addFinalizer(() => Effect.sync(() => listener.closeAllConnections()))
    const router = Context.get(context, HttpRouter.HttpRouter).asHttpEffect()
    const app = Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, "http://localhost")
      if (
        !hasPtyConnectTicketURL(url) &&
        !hasPersistentPtyConnectTicketURL(url) &&
        !(yield* authorizedRequest(request, auth))
      ) {
        return HttpServerResponse.empty({ status: 401, headers: { "www-authenticate": 'Basic realm="Secure Area"' } })
      }
      return yield* router
    }).pipe(Effect.provideService(HttpPlatform.HttpPlatform, Context.get(context, HttpPlatform.HttpPlatform)))
    yield* http.serve(app)
    // Resolve consent while holding the same lease used by telemetry settings writes.
    const telemetry = options.persistedTelemetry
      ? yield* Effect.promise(async () => {
          const { TelemetrySettings } = await import("./telemetry-settings")
          return TelemetrySettings.resolve(input.telemetryConfig)
        })
      : options.telemetry
    if (telemetry?.enabled) {
      const { OpenCode } = yield* Effect.promise(() => import("@opencode-ai/client"))
      const { exportActivity } = yield* Effect.promise(() => import("./telemetry"))
      yield* exportActivity(
        OpenCode.make({
          baseUrl: urls()[0],
          headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
        }),
        telemetry,
        {},
      )
    }
    if (options.recover !== false) {
      yield* Effect.forkScoped(Context.get(context, SessionRestart.Service).resumeSuspendedSessions)
    }
    return {
      url: urls()[0],
      auth: { type: "basic" as const, username: "opencode", password },
      // In-process import only; this function is not registered on HTTP or RPC.
      importCredential: createCredentialImporter(Context.get(context, Credential.Service)),
    }
  }).pipe(
    Effect.provide(NodeHttpServer.layerHttpServices),
    Effect.provideService(References.MinimumLogLevel, "Error"),
    Effect.provideService(Logger.LogToStderr, true),
  )
}
