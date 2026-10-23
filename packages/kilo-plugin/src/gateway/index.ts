// kilo_port(gateway:e8673ed1650b) v1 kilo.ts imported the Gateway SDK and base URL; v2 imports the Gateway logic.
import {
  KiloAccount,
  KiloAutocomplete,
  KiloDefaults,
  KiloDevice,
  KiloErrors,
  KiloHeaders,
  KiloMachine,
  KiloModels,
  KiloModes,
  KiloNotifications,
  KiloProfile,
  KiloProject,
  KiloRequests,
  KiloServer,
  KiloStream,
  KiloTrpc,
} from "@kilocode/gateway-core"
import type { ConnectionInfo } from "@opencode/client"
// Core internals with no public surface: the global Bus (the organization event reaches the plugin instances of other
// Locations), Location config (account precedence), effective config entries for enterprise policy, and the
// upstream reasoning variants of a model.
import { Bus } from "@opencode/core/bus"
import { Config } from "@opencode/core/config"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Variant } from "@opencode/core/variant"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { IntegrationID, IntegrationMethodID } from "@opencode/schema/integration-id"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { Global } from "@opencode/util/global"
import { KiloOrganizationModes } from "./modes"
import { createHash, randomUUID } from "node:crypto"
import { Clock, Duration, Effect, Fiber, Option, Schedule, Schema, Scope, Semaphore, Stream } from "effect"
import { GatewayOptions } from "./options.js"
import { GatewayPrompt } from "./prompt.js"

// v2 adapter for the Kilo Gateway (issue #14991, PRs 1-3: login, teams, catalog authority, requests, and errors).
// Kilo logic lives in @kilocode/gateway-core; this file maps it onto the v2 plugin API. The `kilocode.gateway` RPC
// contract lives in `@opencode/schema/kilocode/gateway`, so clients import it without Core or this package.
const id = Provider.ID.make("kilo")
const integrationID = IntegrationID.make("kilo")
const methodID = IntegrationMethodID.make("device")
const REFRESH_INTERVAL = Duration.minutes(5)
const MAX_SNAPSHOTS = 10
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const IS_TEST_RUNNER = /\.test\.[cm]?[jt]sx?$/.test(process.argv[1] ?? "")

// Written by the device method. Decoded again because stored credentials are read back from the database.
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Schema.NullOr(Schema.String)),
})
const decodeMetadata = Schema.decodeUnknownOption(Metadata)
const decodeSettings = Schema.decodeUnknownOption(
  Schema.Struct({
    apiKey: Schema.optional(Schema.String),
    kilocodeToken: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String),
    kilocodeOrganizationId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)
// The team choice in plugin storage. `null` is the personal account.
const decodeSelection = Schema.decodeUnknownOption(Schema.Struct({ organizationID: Schema.NullOr(Schema.String) }))
// The last good catalog of one personal or anonymous scope: its models and its default model.
const decodeSnapshot = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({ models: Schema.Array(Schema.Unknown), defaultModelID: Schema.optional(Schema.String) }),
  ),
)
// Published on the global bus (`{ global: true }`), so plugin instances of other locations also reload.
const OrganizationEvent = Bus.ephemeral({
  type: `rpc.${KiloGatewayRpc.Definition.id}.organization`,
  schema: {
    organizationID: Schema.NullOr(Schema.String),
    source: Schema.optional(Schema.String),
  },
})

interface Snapshot {
  readonly models: readonly KiloModels.Model[]
  readonly defaultModelID?: string
}

interface CatalogState {
  readonly account?: KiloAccount.Info
  readonly organizationID?: string
  readonly connection?: ConnectionInfo
  readonly envActive: boolean
  readonly models: readonly KiloModels.Model[]
  readonly defaultModelID?: string
  readonly failed: boolean
  readonly failure?: KiloModels.Failure
  readonly anonymous: boolean
  readonly skippedOfflineTest?: boolean
}

export const KiloGatewayPlugin = define<Bus.Service | Global.Service | Scope.Scope>({
  id: "kilocode.gateway",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const global = yield* Global.Service
    const configService = yield* Effect.serviceOption(Config.Service)
    if (Option.isNone(configService)) return yield* Effect.die(new Error("Kilo Gateway requires location config"))
    const config = configService.value
    let policy = yield* KiloConfigPolicy.get(config)
    const scope = yield* Scope.Scope
    const instanceID = randomUUID()
    const lock = Semaphore.makeUnsafe(1)
    let server = KiloServer.fromEnv()
    let gateway = KiloServer.aiGatewayFromEnv()
    let epoch = 0
    let catalog: CatalogState = {
      envActive: false,
      models: [],
      failed: false,
      anonymous: true,
    }
    const scopeCompatible = () => !catalog.organizationID && (!catalog.account || KiloAccount.compatible(catalog.account))
    const activeAccount = () => scopeCompatible() && catalog.account?.token ? catalog.account : undefined
    const lastGood = new Map<string, Snapshot>()
    const sessionMetadata = new Map<string, KiloGatewayRpc.SessionMetadata>()
    let retryFiber: Fiber.Fiber<void, never> | undefined
    let cachedProjectID: string | null | undefined
    let cachedMachineID: string | null | undefined
    let organizationModes: readonly KiloModes.OrganizationMode[] = []

    const getProjectID = Effect.gen(function* () {
      if (cachedProjectID !== undefined) return cachedProjectID ?? undefined
      const resolved = yield* KiloProject.resolve(ctx.location.directory)
      cachedProjectID = resolved ?? null
      return resolved
    })

    const getMachineID = Effect.gen(function* () {
      if (process.env.KILO_MACHINE_ID?.trim()) return process.env.KILO_MACHINE_ID.trim()
      if (cachedMachineID !== undefined) return cachedMachineID ?? undefined
      const resolved = yield* KiloMachine.get(global.data)
      cachedMachineID = resolved ?? null
      return resolved
    })

    const cancelRetry = Effect.gen(function* () {
      if (!retryFiber) return
      const fiber = retryFiber
      retryFiber = undefined
      yield* Fiber.interrupt(fiber)
    })

    const resolveCurrentAccount = Effect.gen(function* () {
      const settings = Option.getOrUndefined(
        decodeSettings(
          Object.assign(
            {},
            ...(yield* configService.value.entries()).flatMap((entry) =>
              entry.type === "document" ? [entry.info.providers?.kilo?.settings ?? {}] : [],
            ),
          ),
        ),
      )
      const envInput = KiloAccount.envToken()
      const configuredServer = settings?.baseURL ? KiloServer.normalize(settings.baseURL) : KiloServer.aiGatewayFromEnv()
      const content = KiloAccount.authContent()
      const connection = content === undefined ? yield* ctx.integration.connection.active(id) : undefined
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const saved =
        content !== undefined ? (content ?? undefined) : credential ? credentialInput(credential) : undefined
      // v1's final provider auth patch runs after config: env > saved OAuth/key > config token > config API key.
      const token = envInput?.token ?? saved?.token ?? settings?.kilocodeToken ?? settings?.apiKey
      const loginServer = !envInput && saved?.server ? KiloServer.normalize(saved.server) : undefined
      const base = settings?.baseURL || (loginServer === KiloServer.fromEnv() ? undefined : loginServer) || configuredServer
      const key = token !== undefined
        ? !envInput && content === undefined && saved && connection
          ? organizationKey(connection)
          : `organization:${snapshotKey(KiloServer.fromToken(token) ?? base, token)}`
        : undefined
      const storedSelection = key ? decodeSelection(yield* ctx.storage.get(key)) : Option.none()
      const legacy =
        key && (envInput || content)
          ? decodeSelection(yield* ctx.storage.get("organization:env"))
          : Option.none()
      const selection = Option.orElse(storedSelection, () => legacy)
      const organizationID = Option.isSome(selection)
        ? selection.value.organizationID
        : saved?.organizationID === null
          ? null
          : saved?.organizationID || settings?.kilocodeOrganizationId
      const account = token !== undefined
        ? KiloAccount.resolve({
            token,
            server: base,
            organizationID: organizationID === "" ? undefined : organizationID,
          })
        : undefined
      // Adopt the old unscoped selection once, then keep all future choices bound to this credential identity.
      if (key && Option.isSome(legacy) && account && KiloAccount.compatible(account)) {
        if (Option.isNone(storedSelection)) yield* ctx.storage.set(key, legacy.value)
        yield* ctx.storage.remove("organization:env")
      }
      return {
        server: KiloServer.apiBase(configuredServer),
        gateway: configuredServer,
        envActive: Boolean(envInput || content !== undefined || (!saved && token !== undefined)),
        connection: !envInput && content === undefined && saved ? connection : undefined,
        selectionKey: key,
        personalSelected:
          (Option.isSome(selection) && selection.value.organizationID === null) ||
          (!envInput && saved?.organizationID === null) ||
          settings?.kilocodeOrganizationId === null,
        account,
        organizationID: account
          ? account.organizationID
          : process.env.KILO_ORG_ID || organizationID || KiloServer.organizationFromUrl(base) || null,
      }
    })

    // Keep valid agents during refresh, but invalidate a changed scope before waiting for the catalog lock.
    const resetOrganizationModes = (resolved: Pick<CatalogState, "account" | "connection" | "envActive">) =>
      Effect.gen(function* () {
        if (
          catalog.account?.token === resolved.account?.token &&
          catalog.account?.server === resolved.account?.server &&
          catalog.account?.organizationID === resolved.account?.organizationID &&
          catalog.envActive === resolved.envActive &&
          (catalog.connection ? organizationKey(catalog.connection) : undefined) ===
            (resolved.connection ? organizationKey(resolved.connection) : undefined)
        )
          return
        KiloModes.clearCache()
        organizationModes = []
        yield* ctx.agent.reload()
      })

    const saveSnapshot = (writeKey: string, snapshot: Snapshot) =>
      Effect.gen(function* () {
        if (!lastGood.has(writeKey) && lastGood.size >= MAX_SNAPSHOTS) {
          const oldest = lastGood.keys().next().value
          if (oldest) lastGood.delete(oldest)
        }
        lastGood.set(writeKey, snapshot)
        if (writeKey.startsWith("catalog:personal:")) {
          const scanned = yield* ctx.storage
            .scan({ prefix: "catalog:personal:" })
            .pipe(Effect.orElseSucceed(() => ({ entries: [] })))
          for (const entry of scanned.entries) {
            if (entry.key !== writeKey) {
              yield* ctx.storage.remove(entry.key).pipe(Effect.catch(() => Effect.void))
            }
          }
        }
        yield* ctx.storage.set(writeKey, JSON.stringify(snapshot)).pipe(Effect.catch(() => Effect.void))
      })

    const readSnapshot = (key: string) =>
      Effect.gen(function* () {
        const memory = lastGood.get(key)
        if (memory) return memory
        const value = yield* ctx.storage.get(key).pipe(Effect.orElseSucceed(() => undefined))
        const decoded = typeof value === "string" ? Option.getOrUndefined(decodeSnapshot(value)) : undefined
        if (!decoded || decoded.models.length === 0) return undefined
        const snapshot: Snapshot = {
          models: decoded.models as readonly KiloModels.Model[],
          defaultModelID: decoded.defaultModelID,
        }
        lastGood.set(key, snapshot)
        return snapshot
      })

    const loadCatalog = Effect.fn("KiloGatewayPlugin.loadCatalog")(function* (
      targetEpoch: number,
      attempt = 0,
    ): Effect.fn.Return<void> {
      const resolved = yield* resolveCurrentAccount
      if (targetEpoch !== epoch) return
      yield* resetOrganizationModes(resolved)
      server = resolved.server
      gateway = resolved.gateway
      let current = resolved.account
      const connection = resolved.connection
      const envActive = resolved.envActive
      const base = current?.baseURL ?? gateway
      const api = current?.server ?? server
      let organizationID = current?.organizationID ?? null
      const token = current?.token

      if (!current && resolved.organizationID) {
        catalog = {
          organizationID: resolved.organizationID,
          connection,
          envActive,
          models: [],
          failed: true,
          failure: { kind: "unauthorized" },
          anonymous: true,
        }
        return
      }

      // A scoped token cannot select another team (or Personal), even if the profile belongs to both teams.
      if (current && !KiloAccount.compatible(current)) {
        catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: false }
        return
      }

      // During unit tests (`IS_TEST_RUNNER`), never make live internet requests to the default production
      // host (`https://api.kilo.ai`) when no local fixture server (`KILO_API_URL`, `KILO_AI_GATEWAY_URL`, or
      // credential server) is used.
      if (
        IS_TEST_RUNNER &&
        !process.env.KILO_API_URL &&
        !process.env.KILO_AI_GATEWAY_URL &&
        !isLoopback(base) &&
        !isLoopback(KiloServer.aiGatewayFromEnv())
      ) {
        catalog = {
          account: current,
          connection,
          envActive,
          models: [],
          failed: false,
          anonymous: token === undefined,
          skippedOfflineTest: true,
        }
        return
      }

      const fetchedProfile: { profile: Option.Option<KiloProfile.Info>; unauthorized: boolean } = token
        ? yield* KiloProfile.get(api, token).pipe(
            Effect.map((profile) => ({ profile: Option.some(profile), unauthorized: false })),
            Effect.catch((error) =>
              Effect.succeed({ profile: Option.none<KiloProfile.Info>(), unauthorized: error.message === "Invalid token" }),
            ),
          )
        : { profile: Option.none<KiloProfile.Info>(), unauthorized: false }
      const profile = fetchedProfile.profile
      if (targetEpoch !== epoch) return
// An outage leaves the team-only status unknown, so fail closed. A rejected token keeps v1's catalog 401
      // fallback to the anonymous free catalog rather than hiding free models from an expired credential.
      if (token && !organizationID && Option.isNone(profile) && !fetchedProfile.unauthorized) {
        catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: false }
        return
      }
      // A key login can have no saved organization. Team-only accounts must not request a personal catalog.
      if (current && !organizationID && Option.isSome(profile) && profile.value.hasPersonalAccount === false) {
        organizationID = KiloProfile.defaultOrganizationID(profile.value)
        if (resolved.personalSelected || !organizationID) {
          catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: false }
          return
        }
        current = { ...current, organizationID }
        if (resolved.selectionKey) yield* ctx.storage.set(resolved.selectionKey, { organizationID })
        if (targetEpoch !== epoch) return
      }
      // Membership in another team does not permit a catalog from this selected scope.
      if (
        organizationID &&
        Option.isSome(profile) &&
        !profile.value.organizations.some((organization) => organization.id === organizationID)
      ) {
        KiloModes.clearCache()
        organizationModes = []
        yield* ctx.agent.reload()
        catalog = { account: current, connection, envActive, models: [], failed: true, failure: { kind: "organization_missing" }, anonymous: false }
        return
      }

      // Organization agents share the same resolved account as the catalog. Errors and empty responses
      // remove them, as v1 loadOrganizationModes did, instead of retaining another scope's instructions.
      const modes = token && organizationID ? yield* KiloModes.get(api, token, organizationID, ctx.app.version) : []
      if (targetEpoch !== epoch) return
      organizationModes = modes
      yield* ctx.agent.reload()

      const [fetched, defaultModelID] = yield* Effect.all(
        [
          KiloModels.get({
            server: base,
            token,
            organizationID,
            version: ctx.app.version,
          }).pipe(Effect.result),
          KiloDefaults.get({
            server: api,
            token,
            organizationID,
            endpoint: base,
          }),
        ],
        { concurrency: 2 },
      )
      if (targetEpoch !== epoch) return

      if (fetched._tag === "Success") {
        const models = fetched.success.models
        const resolvedDefault =
          models.some((model) => model.id === defaultModelID)
            ? defaultModelID
            : organizationID
              ? models[0]?.id
              : // Only a custom server answers no personal default: keep the default on the Kilo provider as v1.
                (defaultModelID ?? KiloDefaults.firstSorted(models.map((model) => model.id)))
        // Key the snapshot by the actual scope of the returned data: a 401 personal fallback returns the
        // anonymous free catalog (`anonymous === true`), so never store it under the personal token key.
        const writeKey = organizationID
          ? undefined
          : snapshotKey(base, fetched.success.anonymous ? undefined : token)
        if (writeKey && models.length > 0) {
          yield* saveSnapshot(writeKey, { models, defaultModelID: resolvedDefault })
        }
        if (targetEpoch !== epoch) return
        catalog = {
          account: current,
          connection,
          envActive,
          models,
          defaultModelID: resolvedDefault,
          failed: false,
          anonymous: fetched.success.anonymous,
        }
        if (models.length === 0) {
          yield* scheduleRetry({ kind: "network" }, targetEpoch, attempt)
        }
        return
      }

      // Team scope always fails closed on error: never fall back to personal, anonymous, or models.dev models.
      if (organizationID) {
        catalog = {
          account: current,
          connection,
          envActive,
          models: [],
          failed: true,
          failure: fetched.failure,
          anonymous: false,
        }
        yield* scheduleRetry(fetched.failure, targetEpoch, attempt)
        return
      }

      // Personal or anonymous scope: keep the last good Gateway catalog for this exact scope, if any.
      // Never fall back to models.dev.
      const stored = yield* readSnapshot(snapshotKey(base, token))
      if (targetEpoch !== epoch) return
      if (stored) {
        catalog = {
          account: current,
          connection,
          envActive,
          models: stored.models,
          // The stored default belongs to the stored models. `KiloDefaults.get` answers its static fallback when the
          // Kilo API is down, so it must not replace the stored default.
          defaultModelID: stored.defaultModelID ?? defaultModelID,
          failed: false,
          anonymous: token === undefined,
        }
      } else {
        catalog = {
          account: current,
          connection,
          envActive,
          models: [],
          failed: true,
          failure: fetched.failure,
          anonymous: token === undefined,
        }
      }
      yield* scheduleRetry(fetched.failure, targetEpoch, attempt)
    })

    function scheduleRetry(failure: KiloModels.Failure, targetEpoch: number, attempt: number) {
      if (!KiloModels.retryable(failure) || targetEpoch !== epoch) return Effect.void
      const delayMs = KiloModels.retryDelayMs(attempt, failure.retryAfter)
      // Do not call `cancelRetry` here because `scheduleRetry` can run inside the active `retryFiber` itself.
      return Effect.sleep(Duration.millis(delayMs)).pipe(
        Effect.andThen(
          lock.withPermit(
            Effect.gen(function* () {
              if (targetEpoch !== epoch) return
              yield* loadCatalog(targetEpoch, attempt + 1)
              if (targetEpoch === epoch) yield* ctx.provider.reload()
            }),
          ),
        ),
        Effect.catch(() => Effect.void),
        Effect.forkIn(scope),
        Effect.tap((fiber) =>
          Effect.sync(() => {
            retryFiber = fiber
          }),
        ),
        Effect.asVoid,
      )
    }

    const reload = Effect.gen(function* () {
      const targetEpoch = ++epoch
      const previous = catalog
      const previousServer = previous.account?.server ?? server
      const previousGateway = previous.account?.baseURL ?? gateway
      const resolved = yield* resolveCurrentAccount
      if (targetEpoch !== epoch) return
      // Refreshes keep usable models; scope changes invalidate them before any Gateway request.
      if (
        previousServer !== (resolved.account?.server ?? resolved.server) ||
        previousGateway !== (resolved.account?.baseURL ?? resolved.gateway) ||
        previous.account?.token !== resolved.account?.token ||
        (previous.account?.organizationID ?? previous.organizationID ?? null) !== resolved.organizationID ||
        JSON.stringify(previous.connection) !== JSON.stringify(resolved.connection)
      ) {
        catalog = { envActive: false, models: [], failed: true, anonymous: true }
        yield* ctx.provider.reload()
      }
      if (targetEpoch !== epoch) return
      server = resolved.server
      gateway = resolved.gateway
      // Same-scope refreshes keep applied agents; changed scopes clear them before the network request.
      yield* resetOrganizationModes(resolved)
      const nextPolicy = yield* KiloConfigPolicy.get(config)
      if (targetEpoch !== epoch) return
      policy = nextPolicy
      yield* cancelRetry
      yield* lock.withPermit(
        loadCatalog(targetEpoch, 0).pipe(
          Effect.andThen(Effect.suspend(() => (targetEpoch === epoch ? ctx.provider.reload() : Effect.void))),
        ),
      )
    })

    yield* ctx.integration.transform((editor) => editor.method.update(device(() => server)))

    // A later start in a personal or anonymous scope with a stored catalog for that exact scope starts with it, so
    // activation does not wait for the network. The fresh catalog loads in the plugin scope and reloads the provider
    // once, as a retry does. The first start (no stored catalog) and team scope, which fails closed, wait for it.
    const start = yield* resolveCurrentAccount
    server = start.server
    gateway = start.gateway
    const stored = start.organizationID
      ? undefined
      : yield* readSnapshot(snapshotKey(start.account?.baseURL ?? gateway, start.account?.token))
    if (stored) {
      catalog = {
        account: start.account,
        connection: start.connection,
        envActive: start.envActive,
        models: stored.models,
        defaultModelID: stored.defaultModelID,
        failed: false,
        anonymous: start.account?.token === undefined,
      }
    }
    yield* stored ? Effect.forkIn(reload, scope) : lock.withPermit(loadCatalog(++epoch, 0))

    // v1 loaded organization modes above built-ins and below local agent definitions. This transform
    // occupies that same pre-config position; replay restores built-ins when a mode is removed.
    yield* ctx.agent.transform((editor) => {
      for (const mode of organizationModes) {
        editor.update(mode.slug, (agent) => {
          const { permissions, ...definition } = KiloOrganizationModes.convert(mode)
          Object.assign(agent, definition, { hidden: false })
          const start = agent.permissions.length
          agent.permissions.push(...permissions)
          KiloOrganizationModes.permissionSpans.set(agent.permissions, [start, agent.permissions.length])
        })
      }
    })

    // kilo_port(gateway:73ba28ce78a5) Gateway base URL, Kilo referer and title, team header, and the token or the
    // anonymous key, which v1 kilo.ts set on the provider.
    yield* ctx.provider.transform((editor) => {
      if (!editor.get(id)) return
      const account = catalog.account
      const base = account?.baseURL ?? gateway
      const baseURL = KiloServer.openrouter(base)
      const headers = KiloHeaders.provider({ version: ctx.app.version, organizationID: account?.organizationID })
      const current = editor.get(id)
      const { apiKey: _, ...restSettings } = current?.provider.settings ?? {}
      const baseSettings = { ...restSettings, baseURL, kiloEmptyToken: account?.token === "" }
      const mergedHeaders = {
        ...current?.provider.headers,
        ...headers,
      }
      if (!account?.organizationID) {
        delete mergedHeaders[KiloHeaders.HEADER_ORGANIZATION]
      }

      if (catalog.skippedOfflineTest) {
        const activation = !account || catalog.anonymous || catalog.envActive || account.token === "" ? "enabled" : "auto"
        const settings =
          !account || catalog.anonymous
            ? { ...baseSettings, apiKey: KiloAccount.ANONYMOUS_KEY }
            : catalog.envActive || account.token === ""
              ? { ...baseSettings, apiKey: account.token }
              : baseSettings
        editor.update(id, (provider) => {
          provider.activation = activation
          provider.settings = settings
          provider.headers = mergedHeaders
        })
        return
      }

      if (catalog.failed || catalog.models.length === 0) {
        // Fail closed: replace the model list with `[]` and set a sentinel `sourceConnection` so `Provider.snapshot`
        // excludes `kilo` from `available` even if a `providers.kilo` block in user config sets `activation: "enabled"`.
        editor.add({
          info: {
            id,
            name: current?.provider.name ?? "Kilo Gateway",
            integrationID,
            activation: "disabled",
            package: "@opencode/ai/providers/openrouter",
            settings: baseSettings,
            headers: mergedHeaders,
          },
          models: [],
          sourceConnection: { type: "env", name: "__kilo_catalog_unavailable__" },
        })
        return
      }

      const activation = !account || catalog.anonymous || catalog.envActive || account.token === "" ? "enabled" : "auto"
      const settings =
        !account || catalog.anonymous
          ? { ...baseSettings, apiKey: KiloAccount.ANONYMOUS_KEY }
          : catalog.envActive || account.token === ""
            ? { ...baseSettings, apiKey: account.token }
            : baseSettings
      const sourceConnection =
        !account || catalog.anonymous || catalog.envActive ? undefined : catalog.connection

      editor.add({
        info: {
          id,
          name: "Kilo Gateway",
          integrationID,
          activation,
          package: "@opencode/ai/providers/openrouter",
          settings,
          headers: mergedHeaders,
        },
        models: catalog.models
          .filter((item) => !policy.hide_prompt_training_models || item.mayTrainOnYourPrompts !== true)
          .map((item) => toModelInfo(item, baseURL, mergedHeaders, Boolean(catalog.account))),
        ...(sourceConnection ? { sourceConnection } : {}),
      })
    })

    yield* ctx.model.transform((models) => {
      if (catalog.failed) {
        for (const model of models.list(id)) {
          models.remove(id, model.id)
        }
        return
      }
      if (
        catalog.defaultModelID &&
        models.list(id).some((model) => model.id === Model.ID.make(catalog.defaultModelID!))
      ) {
        models.default.set(id, Model.ID.make(catalog.defaultModelID))
        return
      }
      if (
        !policy.hide_prompt_training_models ||
        !catalog.models.some((model) => model.id === catalog.defaultModelID && model.mayTrainOnYourPrompts === true)
      )
        return
      const allowed = models.list(id).find((model) => model.enabled !== false && model.status === "active")
      if (allowed) models.default.set(id, allowed.id)
    })

    const prepareOptions = (event: SessionHooks["context"] | SessionHooks["title"]) =>
      Effect.gen(function* () {
        const source = catalog.models.find((model) => model.id === event.model.id)
        if (!source) return
        const model = (yield* ctx.model.list()).data.find(
          (model) => model.providerID === id && model.id === event.model.id,
        )
        const provider = (yield* ctx.provider.get({ providerID: id })).data
        const variant = model?.variants.find((variant) => variant.id === event.model.variant)
        Object.assign(
          event.options,
          GatewayOptions.request(source.aiSDKProvider, [
            provider.settings,
            model?.settings,
            variant?.settings,
            event.options,
          ]),
        )
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", prepareOptions, { providerID: id })
    yield* ctx.session.hook("compaction", prepareOptions, { providerID: id })
    yield* ctx.session.hook("generate", prepareOptions, { providerID: id })
    yield* ctx.session.hook("title", prepareOptions, { providerID: id })

    const preparePrompt = (event: SessionHooks["context"]) =>
      Effect.gen(function* () {
        const source = catalog.models.find((model) => model.id === event.model.id)
        if (!source || (yield* ctx.agent.get({ agentID: event.agent })).data.system) return
        const text = GatewayPrompt.render(source, Object.keys(event.tools))
        if (text !== undefined && event.system[0]) event.system[0] = { ...event.system[0], text }
      }).pipe(Effect.catch(() => Effect.void))
    yield* ctx.session.hook("context", preparePrompt, { providerID: id })
    yield* ctx.session.hook("compaction", preparePrompt, { providerID: id })
    yield* ctx.session.hook("generate", preparePrompt, { providerID: id })

    // Per-request attribution headers (`X-KILOCODE-TASKID`, `X-KILOCODE-PARENT-TASKID`, `X-KILOCODE-PROJECTID`,
    // `X-KILOCODE-MACHINEID`, `x-kilocode-mode`, `User-Agent`, plus provider headers).
    // kilo_port(gateway:50352226b43c) v1 resolved the project ID, machine ID, and parent session in request.ts.
    yield* ctx.session.hook(
      "model.request",
      (event) =>
        Effect.gen(function* () {
          const [session, projectID, machineID] = yield* Effect.all(
            [
              ctx.session.get({ sessionID: event.sessionID }).pipe(Effect.option),
              getProjectID,
              getMachineID,
            ],
            { concurrency: 3 },
          )
          const parentSessionID = Option.isSome(session) ? session.value.parentID : undefined
          const requestHeaders = KiloHeaders.request({
            version: ctx.app.version,
            organizationID: catalog.account?.organizationID,
            sessionID: event.sessionID,
            parentSessionID,
            projectID,
            machineID,
            mode: event.agent,
          })
          event.baseURL = KiloServer.openrouter(catalog.account?.baseURL ?? gateway)
          Object.assign(event.headers, requestHeaders)
        }),
      { providerID: id },
    )

    // The generic resolver intentionally prefers saved credentials. Kilo owns its account precedence, so enforce
    // the resolved scope at the last public boundary, after every native dialect has applied its credentials.
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.sync(() => {
          if (catalog.failed) throw new Error("Unable to retrieve Kilo model catalog")
          const headers = new Headers(event.request.headers)
          headers.delete("x-api-key")
          const token = catalog.anonymous
            ? KiloAccount.ANONYMOUS_KEY
            : catalog.account?.token ?? KiloAccount.ANONYMOUS_KEY
          headers.set("authorization", `Bearer ${token}`)
          headers.delete(KiloHeaders.HEADER_ORGANIZATION)
          if (!catalog.anonymous && catalog.account?.organizationID) {
            headers.set(KiloHeaders.HEADER_ORGANIZATION, catalog.account.organizationID)
          }
          event.request = new Request(event.request, { headers })
        }),
      { providerID: id },
    )

    // Request body and auth normalization (`x-api-key` -> `Bearer`, credential metadata stripping,
    // stateless `/responses` item stripping, and `provider.data_collection`).
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.gen(function* () {
          const current = yield* KiloConfigPolicy.get(config)
          const dataCollection =
            current.hide_prompt_training_models || process.env.KILO_DATA_COLLECTION === "deny"
              ? ("deny" as const)
              : process.env.KILO_DATA_COLLECTION === "allow"
                ? ("allow" as const)
                : undefined
          event.request = yield* Effect.promise(() => KiloRequests.rewriteRequest(event.request, { dataCollection }))
        }),
      { providerID: id },
    )

    // Error contract and SSE stream metadata (`routedModelID`, `x-vercel-id`, and mid-stream SSE errors).
    yield* ctx.session.hook(
      "http.response",
      (event) =>
        Effect.promise(async () => {
          if (event.response.status >= 400) {
            event.response = await KiloErrors.rewriteHttpResponse(event.response)
            return
          }
          event.response = KiloStream.transformResponse(event.response, (meta) => {
            if (meta.routedModelID || meta.vercelID) {
              const prev = sessionMetadata.get(event.sessionID)
              if (!prev && sessionMetadata.size >= 500) {
                const oldest = sessionMetadata.keys().next().value
                if (oldest) sessionMetadata.delete(oldest)
              }
              sessionMetadata.set(event.sessionID, {
                ...(prev?.routedModelID ? { routedModelID: prev.routedModelID } : {}),
                ...(prev?.vercelID ? { vercelID: prev.vercelID } : {}),
                ...(meta.routedModelID ? { routedModelID: meta.routedModelID } : {}),
                ...(meta.vercelID ? { vercelID: meta.vercelID } : {}),
              })
            }
          })
        }),
      { providerID: id },
    )

    yield* ctx.rpc
      .register(KiloGatewayRpc.Definition, {
        authStatus: () =>
          Effect.sync(() => {
            const account = scopeCompatible() ? catalog.account : undefined
            return {
              authenticated: Boolean(account?.token),
              organizationID: account?.organizationID ?? catalog.organizationID ?? null,
              server: catalog.account?.server ?? server,
            }
          }),
        profile: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            const profile = yield* KiloProfile.get(account.server, account.token).pipe(
              Effect.mapError((error) => context.error("failed", error.message)),
            )
            return {
              email: profile.email,
              ...(profile.name ? { name: profile.name } : {}),
              organizations: profile.organizations,
              hasPersonalAccount: profile.hasPersonalAccount !== false,
              organizationID: account.organizationID,
            }
          }),
        balance: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            const result = yield* KiloProfile.balance(account.server, account.token, account.organizationID)
            return {
              balance: result?.balance ?? null,
              ...(result?.isDepleted !== undefined ? { isDepleted: result.isDepleted } : {}),
            }
          }),
        kiloPass: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            return yield* KiloTrpc.kiloPass(account.server, account.token, ctx.app.version, account.organizationID)
          }),
        byok: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            return yield* KiloTrpc.byokEntries(
              account.server,
              account.token,
              ctx.app.version,
              account.organizationID,
            ).pipe(Effect.mapError((error) => context.error("failed", error.message)))
          }),
        codingPlans: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            return yield* KiloTrpc.codingPlanSubscriptions(
              account.server,
              account.token,
              ctx.app.version,
              account.organizationID,
            ).pipe(Effect.mapError((error) => context.error("failed", error.message)))
          }),
        codingPlanUsage: (input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            return yield* KiloTrpc.codingPlanUsage(
              account.server,
              account.token,
              input.subscriptionID,
              ctx.app.version,
              account.organizationID,
            ).pipe(Effect.mapError((error) => context.error("failed", error.message)))
          }),
        "organization.set": (input, context) =>
          Effect.gen(function* () {
            const resolved = yield* resolveCurrentAccount
            if (!resolved.selectionKey || !resolved.account?.token)
              return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            if (!KiloAccount.compatible({ ...resolved.account, organizationID: input.organizationID })) {
              return yield* Effect.fail(context.error("failed", "Organization conflicts with the Kilo token scope"))
            }
            const profile = yield* KiloProfile.get(resolved.account.server, resolved.account.token).pipe(
              Effect.mapError((error) => context.error("failed", error.message)),
            )
            if (input.organizationID === null && profile.hasPersonalAccount === false)
              return yield* Effect.fail(context.error("failed", "This Kilo account has no personal account"))
            if (input.organizationID !== null && !profile.organizations.some((organization) => organization.id === input.organizationID))
              return yield* Effect.fail(context.error("failed", "This Kilo account is not a member of the organization"))
            KiloModes.clearCache()
            yield* ctx.storage.set(resolved.selectionKey, { organizationID: input.organizationID })
            yield* reload
            yield* bus.publish(
              OrganizationEvent,
              { organizationID: input.organizationID, source: instanceID },
              { global: true },
            )
            if (catalog.failed)
              return yield* Effect.fail(context.error("failed", "Organization selected, but its model catalog is unavailable"))
            return {}
          }),
        modes: (_input, context) =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            if (!account.organizationID) return []
            return organizationModes
          }),
        notifications: () =>
          Effect.gen(function* () {
            const account = activeAccount()
            if (!account) return []
            return yield* KiloNotifications.get(
              account.server,
              account.token,
              account.organizationID,
              ctx.app.version,
            )
          }),
        models: (_input, context) =>
          Effect.gen(function* () {
            if (catalog.failed) {
              const failure = catalog.failure ?? { kind: "network" as const, status: undefined }
              return yield* Effect.fail(
                context.error("failed", KiloErrors.catalogMessage(failure), {
                  kind: failure.kind,
                  ...(failure.status === undefined ? {} : { status: failure.status }),
                }),
              )
            }
            return KiloModels.entries(catalog.models).map((model) => ({
              ...model,
              ...(model.id === catalog.defaultModelID ? { recommended: true } : {}),
            }))
          }),
        "models.images": (_input, context) =>
          Effect.gen(function* () {
            if (!scopeCompatible()) return yield* Effect.fail(context.error("unauthorized", "Organization conflicts with the Kilo token scope"))
            return yield* KiloModels.imageModels({
              server: catalog.account?.baseURL ?? gateway,
              token: catalog.account?.token,
              organizationID: catalog.account?.organizationID,
              version: ctx.app.version,
            }).pipe(Effect.mapError(() => context.error("failed", "Unable to retrieve Kilo image models")))
          }),
        "models.transcriptions": (_input, context) =>
          Effect.gen(function* () {
            if (!scopeCompatible()) return yield* Effect.fail(context.error("unauthorized", "Organization conflicts with the Kilo token scope"))
            return yield* KiloModels.transcriptionModels({
              server: catalog.account?.baseURL ?? gateway,
              token: catalog.account?.token,
              organizationID: catalog.account?.organizationID,
              version: ctx.app.version,
            }).pipe(Effect.mapError(() => context.error("failed", "Unable to retrieve Kilo transcription models")))
          }),
        "models.embeddings": (_input, context) =>
          Effect.gen(function* () {
            if (!scopeCompatible()) return yield* Effect.fail(context.error("unauthorized", "Organization conflicts with the Kilo token scope"))
            return yield* KiloModels.embeddingModels({
              server: catalog.account?.baseURL ?? gateway,
              version: ctx.app.version,
            }).pipe(Effect.mapError(() => context.error("failed", "Unable to retrieve Kilo embedding models")))
          }),
        "autocomplete.fimTarget": (input, context) =>
          Effect.suspend(() => {
            const target = KiloAutocomplete.resolveFimTarget(input.provider, input.model, catalog.account?.baseURL ?? gateway)
            if (target.provider === "kilo" && !scopeCompatible()) return Effect.fail(context.error("unauthorized", "Organization conflicts with the Kilo token scope"))
            return Effect.succeed(target)
          }),
        "autocomplete.editTarget": (input, context) =>
          Effect.suspend(() => {
            const target = KiloAutocomplete.resolveEditTarget(input.provider, input.model, catalog.account?.baseURL ?? gateway)
            if (target.provider === "kilo" && !scopeCompatible()) return Effect.fail(context.error("unauthorized", "Organization conflicts with the Kilo token scope"))
            return Effect.succeed(target)
          }),
        "session.metadata": (input) =>
          Effect.sync(() => sessionMetadata.get(input.sessionID) ?? {}),
      })
      .pipe(Effect.orDie)

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          (event.type === "credential.switched" && event.data.integrationID === integrationID) ||
          event.type === "config.updated" ||
          (event.type === OrganizationEvent.type && event.data.source !== instanceID),
      ),
      Stream.runForEach(() => Effect.forkIn(reload, scope, { startImmediately: true }).pipe(Effect.asVoid)),
      Effect.forkScoped({ startImmediately: true }),
    )

    // Periodic catalog refresh every 5 minutes in production, matching v1 model-cache TTL.
    if (!IS_TEST_RUNNER) {
      yield* Effect.repeat(
        Effect.sleep(REFRESH_INTERVAL).pipe(Effect.andThen(reload), Effect.catch(() => Effect.void)),
        Schedule.forever,
      ).pipe(Effect.forkScoped)
    }
  }),
})

function isLoopback(server: string): boolean {
  if (!URL.canParse(server)) return false
  return LOOPBACK.has(new URL(server).hostname.toLowerCase())
}

function snapshotKey(server: string, token?: string): string {
  const route = KiloServer.gateway(server)
  if (token === undefined) return `catalog:anonymous:${route}`
  const hash = createHash("sha256").update(`${route}:${token}`).digest("hex")
  return `catalog:personal:${hash}`
}

// kilo_port(gateway:742c02b40457) v1 kilo.ts created one Kilo SDK for all models; v2 picks the dialect per model.
function packageFor(aiSDKProvider?: KiloModels.AISDKProvider): string {
  if (aiSDKProvider === "anthropic") return "@opencode/ai/providers/anthropic"
  if (aiSDKProvider === "openai") return "@opencode/ai/providers/openai"
  if (aiSDKProvider === "openai-compatible") return "@opencode/ai/providers/openai-compatible"
  // kilo_port(gateway:0278ba0eb6aa) v1 sent Gateway provider options under the `openrouter` key.
  return "@opencode/ai/providers/openrouter"
}

function toModelInfo(
  source: KiloModels.Model,
  baseURL: string,
  headers: Record<string, string>,
  credentials: boolean,
): Model.Info {
  const modelID = Model.ID.make(source.id)
  // kilo_port(gateway:f983d8f993c8) v1 copied OpenRouter-shaped options to every SDK; v2 uses one dialect per model.
  const pkg = packageFor(source.aiSDKProvider)
  const settings = {
    baseURL,
    ...(source.id === KiloDefaults.SMALL_MODEL ? { kiloCredentials: credentials } : {}),
    ...(pkg === "@opencode/ai/providers/openai-compatible" ? { provider: id } : {}),
    ...(source.aiSDKProvider === "openai" ? { store: false } : {}),
    // kilo_port(gateway:e19fc2acea57) Native OpenRouter includes usage; Gateway Gemini 3 defaults to high reasoning.
    ...GatewayOptions.lower(
      source.aiSDKProvider,
      source.id.includes("gemini-3") ? { reasoning: { effort: "high" } } : {},
    ),
  }
  const base: Model.Info = {
    id: modelID,
    modelID,
    providerID: id,
    name: source.name,
    ...(source.family ? { family: Model.Family.make(source.family) } : {}),
    package: pkg,
    settings,
    headers: { ...headers },
    capabilities: {
      tools: true,
      input: [...source.capabilities.input],
      output: [...source.capabilities.output],
    },
    variants: [],
    time: { released: 0 },
    cost: source.cost
      ? [
          {
            input: Money.USDPerMillionTokens.make(source.cost.input),
            output: Money.USDPerMillionTokens.make(source.cost.output),
            cache: {
              read: Money.USDPerMillionTokens.make(source.cost.cacheRead ?? 0),
              write: Money.USDPerMillionTokens.make(source.cost.cacheWrite ?? 0),
            },
          },
        ]
      : [],
    status: "active",
    enabled: true,
    limit: {
      context: source.limit.context,
      output: source.limit.output,
    },
  }
  return {
    ...base,
    // kilo_port(gateway:59f57027c538) Explicit backend variants take precedence, including custom names/options.
    variants:
      source.variants && Object.keys(source.variants).length > 0
        ? Object.entries(source.variants)
            // The native picker owns "default"; empty IDs cannot select a variant.
            .filter(([name]) => name !== "" && name !== "default")
            .map(([name, options]) => ({
              id: Model.VariantID.make(name),
              settings: GatewayOptions.lower(source.aiSDKProvider, options),
            }))
        : source.reasoning
          ? Variant.resolve(base, source.reasoningOptions)
          : [],
  }
}

function device(server: () => string) {
  return {
    integrationID: id,
    method: { id: methodID, type: "oauth", label: "Kilo Gateway (Device Authorization)" },
    authorize: () =>
      Effect.gen(function* () {
        const base = server()
        const code = yield* KiloDevice.start(base)
        return {
          mode: "auto" as const,
          url: code.verificationUrl,
          instructions: `Enter code: ${code.code}`,
          expiresAt: (yield* Clock.currentTimeMillis) + code.expiresIn * 1000,
          callback: Effect.gen(function* () {
            const login = yield* KiloDevice.login(base, code)
            // v1 reuses the token as the refresh token and has no refresh endpoint.
            return Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: login.token,
              refresh: login.token,
              expires: (yield* Clock.currentTimeMillis) + KiloDevice.TOKEN_LIFETIME_MS,
              metadata: { server: base, organizationID: login.organizationID, email: login.email },
            })
          }),
        }
      }),
    label: (credential) => (typeof credential.metadata?.email === "string" ? credential.metadata.email : undefined),
  } satisfies IntegrationOAuthMethodRegistration
}

function organizationKey(
  connection: { readonly type: "credential"; readonly id: string } | { readonly type: "env"; readonly name: string },
) {
  return `organization:${connection.type === "credential" ? connection.id : `env:${connection.name}`}`
}

function credentialInput(credential: Credential.Value): KiloAccount.Input | undefined {
  if (credential.type === "external") return undefined
  const metadata = Option.getOrUndefined(decodeMetadata(credential.metadata ?? {}))
  return {
    token: credential.type === "oauth" ? credential.access : credential.key,
    server: metadata?.server,
    organizationID: metadata?.organizationID,
  }
}
