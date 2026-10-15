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
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { IntegrationID, IntegrationMethodID } from "@opencode/schema/integration-id"
import { Model } from "@opencode/schema/model"
import { Money } from "@opencode/schema/money"
import { Provider } from "@opencode/schema/provider"
import { Global } from "@opencode/util/global"
import { createHash, randomUUID } from "node:crypto"
import { Clock, Duration, Effect, Fiber, Option, Schedule, Schema, Scope, Semaphore, Stream } from "effect"
import { Bus } from "../bus.js"
import { Variant } from "../variant.js"
import { KiloGatewayRpc } from "./gateway-rpc.js"

// v2 adapter for the Kilo Gateway (issue #14991, PRs 1-3: login, teams, catalog authority, requests, and errors).
// Kilo logic lives in @kilocode/gateway-core; this file maps it onto the v2 plugin API.
const id = Provider.ID.make("kilo")
const integrationID = IntegrationID.make("kilo")
const methodID = IntegrationMethodID.make("device")
const REFRESH_INTERVAL = Duration.minutes(5)
const MAX_SNAPSHOTS = 10
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"])
const IS_TEST_RUNNER = typeof Bun !== "undefined" && /\.test\.[cm]?[jt]sx?$/.test(Bun.main)

// Written by the device method. Decoded again because stored credentials are read back from the database.
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Schema.NullOr(Schema.String)),
})
const decodeMetadata = Schema.decodeUnknownOption(Metadata)
// The team choice in plugin storage. `null` is the personal account.
const decodeSelection = Schema.decodeUnknownOption(Schema.Struct({ organizationID: Schema.NullOr(Schema.String) }))
const decodeStoredModels = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))
// Published on the global bus (`{ global: true }`), so plugin instances of other locations also reload.
const OrganizationEvent = Bus.ephemeral({
  type: `rpc.${KiloGatewayRpc.Definition.id}.organization`,
  schema: {
    organizationID: Schema.NullOr(Schema.String),
    source: Schema.optional(Schema.String),
  },
})

interface CatalogState {
  readonly account?: KiloAccount.Info
  readonly connection?: ConnectionInfo
  readonly envActive: boolean
  readonly models: readonly KiloModels.Model[]
  readonly defaultModelID?: string
  readonly failed: boolean
  readonly anonymous: boolean
  readonly skippedOfflineTest?: boolean
}

export const KiloGatewayPlugin = define<Bus.Service | Scope.Scope>({
  id: "kilocode.gateway",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const scope = yield* Scope.Scope
    const instanceID = randomUUID()
    const lock = Semaphore.makeUnsafe(1)
    const server = KiloServer.fromEnv()
    let epoch = 0
    let catalog: CatalogState = {
      envActive: false,
      models: [],
      failed: false,
      anonymous: true,
    }
    const lastGood = new Map<string, readonly KiloModels.Model[]>()
    const sessionMetadata = new Map<string, KiloGatewayRpc.SessionMetadata>()
    let retryFiber: Fiber.Fiber<void, never> | undefined
    let cachedProjectID: string | null | undefined
    let cachedMachineID: string | null | undefined

    const getProjectID = Effect.gen(function* () {
      if (cachedProjectID !== undefined) return cachedProjectID ?? undefined
      const resolved = yield* KiloProject.resolve(ctx.location.directory)
      cachedProjectID = resolved ?? null
      return resolved
    })

    const getMachineID = Effect.gen(function* () {
      if (process.env.KILO_MACHINE_ID?.trim()) return process.env.KILO_MACHINE_ID.trim()
      if (cachedMachineID !== undefined) return cachedMachineID ?? undefined
      const resolved = yield* KiloMachine.get(Global.Path.data)
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
      // Environment tokens (`KILO_API_KEY`, `KILOCODE_TOKEN`, `KILO_AUTH_CONTENT`) take precedence over stored
      // credentials, matching v1 (`acd3d1ff9b`) and supporting headless/cloud consumers.
      const envInput = KiloAccount.envToken()
      if (envInput) {
        const selection = decodeSelection(yield* ctx.storage.get("organization:env"))
        return {
          envActive: true,
          connection: undefined,
          account: KiloAccount.resolve({
            ...envInput,
            server,
            organizationID: Option.isSome(selection) ? selection.value.organizationID : envInput.organizationID,
          }),
        }
      }
      const connection = yield* ctx.integration.connection.active(id)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const selection = connection ? decodeSelection(yield* ctx.storage.get(organizationKey(connection))) : Option.none()
      return {
        envActive: false,
        connection,
        account: credential ? toAccount(credential, Option.getOrUndefined(selection)) : undefined,
      }
    })

    const saveSnapshot = (writeKey: string, models: readonly KiloModels.Model[]) =>
      Effect.gen(function* () {
        if (!lastGood.has(writeKey) && lastGood.size >= MAX_SNAPSHOTS) {
          const oldest = lastGood.keys().next().value
          if (oldest) lastGood.delete(oldest)
        }
        lastGood.set(writeKey, models)
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
        yield* ctx.storage.set(writeKey, JSON.stringify(models)).pipe(Effect.catch(() => Effect.void))
      })

    const loadCatalog = Effect.fn("KiloGatewayPlugin.loadCatalog")(function* (
      targetEpoch: number,
      attempt = 0,
    ): Effect.fn.Return<void> {
      const resolved = yield* resolveCurrentAccount
      if (targetEpoch !== epoch) return
      const current = resolved.account
      const connection = resolved.connection
      const envActive = resolved.envActive
      const base = current?.server ?? server
      const organizationID = current?.organizationID ?? null
      const token = current?.token

      // During unit tests (`IS_TEST_RUNNER`), never make live internet requests to the default production
      // host (`https://api.kilo.ai`) when no local fixture server (`KILO_API_URL` or credential server) is used.
      if (IS_TEST_RUNNER && !process.env.KILO_API_URL && !isLoopback(base)) {
        catalog = {
          account: current,
          connection,
          envActive,
          models: [],
          failed: false,
          anonymous: !token,
          skippedOfflineTest: true,
        }
        return
      }

      // Team scope: verify team membership when a profile endpoint is reachable; fail closed if the team is
      // missing or the team catalog request fails.
      if (token && organizationID) {
        const profile = yield* KiloProfile.get(base, token).pipe(Effect.option)
        if (targetEpoch !== epoch) return
        if (
          Option.isSome(profile) &&
          !profile.value.organizations.some((organization) => organization.id === organizationID)
        ) {
          catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: false }
          return
        }
      }

      const [fetched, defaultModelID] = yield* Effect.all(
        [
          KiloModels.get({
            server: base,
            token,
            organizationID,
            version: ctx.app.version,
          }).pipe(Effect.result),
          KiloDefaults.get({
            server: base,
            token,
            organizationID,
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
              : defaultModelID
        // Key the snapshot by the actual scope of the returned data: a 401 personal fallback returns the
        // anonymous free catalog (`anonymous === true`), so never store it under the personal token key.
        const writeKey = organizationID
          ? undefined
          : snapshotKey(base, fetched.success.anonymous ? undefined : token)
        if (writeKey && models.length > 0) {
          yield* saveSnapshot(writeKey, models)
        }
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
        catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: false }
        yield* scheduleRetry(fetched.failure, targetEpoch, attempt)
        return
      }

      // Personal or anonymous scope: keep the last good Gateway catalog for this exact scope, if any.
      // Never fall back to models.dev.
      const cacheKey = snapshotKey(base, token)
      const memory = lastGood.get(cacheKey)
      const stored =
        memory ??
        (yield* ctx.storage.get(cacheKey).pipe(
          Effect.map((value) => {
            const decoded = typeof value === "string" ? Option.getOrUndefined(decodeStoredModels(value)) : undefined
            return Array.isArray(decoded) ? (decoded as readonly KiloModels.Model[]) : undefined
          }),
          Effect.orElseSucceed(() => undefined),
        ))
      if (targetEpoch !== epoch) return
      if (stored && stored.length > 0) {
        lastGood.set(cacheKey, stored)
        catalog = {
          account: current,
          connection,
          envActive,
          models: stored,
          defaultModelID,
          failed: false,
          anonymous: !token,
        }
      } else {
        catalog = { account: current, connection, envActive, models: [], failed: true, anonymous: !token }
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

    const reload = Effect.suspend(() => {
      const targetEpoch = ++epoch
      return cancelRetry.pipe(
        Effect.andThen(
          lock.withPermit(
            loadCatalog(targetEpoch, 0).pipe(
              Effect.andThen(Effect.suspend(() => (targetEpoch === epoch ? ctx.provider.reload() : Effect.void))),
            ),
          ),
        ),
      )
    })

    yield* ctx.integration.transform((editor) => editor.method.update(device(server)))

    yield* lock.withPermit(loadCatalog(++epoch, 0))

    yield* ctx.provider.transform((editor) => {
      if (!editor.get(id)) return
      const account = catalog.account
      const base = account?.server ?? server
      const baseURL = KiloServer.gateway(base)
      const headers = KiloHeaders.provider({ version: ctx.app.version, organizationID: account?.organizationID })
      const current = editor.get(id)
      const { apiKey: _, ...restSettings } = current?.provider.settings ?? {}
      const baseSettings = { ...restSettings, baseURL }
      const mergedHeaders = {
        ...current?.provider.headers,
        ...headers,
      }
      if (!account?.organizationID) {
        delete mergedHeaders[KiloHeaders.HEADER_ORGANIZATION]
      }

      if (catalog.skippedOfflineTest) {
        const activation = !account || catalog.anonymous || catalog.envActive ? "enabled" : "auto"
        const settings =
          !account || catalog.anonymous
            ? { ...baseSettings, apiKey: KiloAccount.ANONYMOUS_KEY }
            : catalog.envActive
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

      const activation = !account || catalog.anonymous || catalog.envActive ? "enabled" : "auto"
      const settings =
        !account || catalog.anonymous
          ? { ...baseSettings, apiKey: KiloAccount.ANONYMOUS_KEY }
          : catalog.envActive
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
        models: catalog.models.map((item) => toModelInfo(item, baseURL, mergedHeaders)),
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
      }
    })

    // Per-request attribution headers (`X-KILOCODE-TASKID`, `X-KILOCODE-PARENT-TASKID`, `X-KILOCODE-PROJECTID`,
    // `X-KILOCODE-MACHINEID`, `x-kilocode-mode`, `User-Agent`, plus provider headers).
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
          Object.assign(event.headers, requestHeaders)
        }),
      { providerID: id },
    )

    // Request body and auth normalization (`x-api-key` -> `Bearer`, credential metadata stripping,
    // stateless `/responses` item stripping, and `provider.data_collection`).
    yield* ctx.session.hook(
      "http.request",
      (event) =>
        Effect.promise(async () => {
          const dataCollection =
            process.env.KILO_DATA_COLLECTION === "deny"
              ? ("deny" as const)
              : process.env.KILO_DATA_COLLECTION === "allow"
                ? ("allow" as const)
                : undefined
          event.request = await KiloRequests.rewriteRequest(event.request, { dataCollection })
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
          Effect.sync(() => ({
            authenticated: Boolean(catalog.account),
            organizationID: catalog.account?.organizationID ?? null,
            server: catalog.account?.server ?? server,
          })),
        profile: (_input, context) =>
          Effect.gen(function* () {
            const account = catalog.account
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            const profile = yield* KiloProfile.get(account.server, account.token).pipe(
              Effect.mapError((error) => context.error("failed", error.message)),
            )
            return {
              email: profile.email,
              organizations: profile.organizations,
              hasPersonalAccount: profile.hasPersonalAccount !== false,
              organizationID: account.organizationID,
            }
          }),
        balance: (_input, context) =>
          Effect.gen(function* () {
            const account = catalog.account
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            const result = yield* KiloProfile.balance(account.server, account.token, account.organizationID)
            return {
              balance: result?.balance ?? null,
              ...(result?.isDepleted !== undefined ? { isDepleted: result.isDepleted } : {}),
            }
          }),
        kiloPass: (_input, context) =>
          Effect.gen(function* () {
            const account = catalog.account
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            return yield* KiloTrpc.kiloPass(account.server, account.token, ctx.app.version, account.organizationID)
          }),
        byok: (_input, context) =>
          Effect.gen(function* () {
            const account = catalog.account
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
            const account = catalog.account
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
            const account = catalog.account
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
            const envInput = KiloAccount.envToken()
            const connection = envInput ? undefined : yield* ctx.integration.connection.active(id)
            const key = envInput ? "organization:env" : connection ? organizationKey(connection) : undefined
            if (!key || !catalog.account)
              return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            KiloModes.clearCache()
            yield* ctx.storage.set(key, { organizationID: input.organizationID })
            yield* reload
            yield* bus.publish(
              OrganizationEvent,
              { organizationID: input.organizationID, source: instanceID },
              { global: true },
            )
            return {}
          }),
        modes: (_input, context) =>
          Effect.gen(function* () {
            const account = catalog.account
            if (!account) return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            if (!account.organizationID) return []
            return yield* KiloModes.get(account.server, account.token, account.organizationID, ctx.app.version)
          }),
        notifications: () =>
          Effect.gen(function* () {
            const account = catalog.account
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
              return yield* Effect.fail(context.error("failed", "Unable to retrieve Kilo model catalog"))
            }
            return KiloModels.entries(catalog.models)
          }),
        "models.images": (_input, context) =>
          KiloModels.imageModels({
            server: catalog.account?.server ?? server,
            token: catalog.account?.token,
            organizationID: catalog.account?.organizationID,
            version: ctx.app.version,
          }).pipe(Effect.mapError(() => context.error("failed", "Unable to retrieve Kilo image models"))),
        "models.transcriptions": (_input, context) =>
          KiloModels.transcriptionModels({
            server: catalog.account?.server ?? server,
            token: catalog.account?.token,
            organizationID: catalog.account?.organizationID,
            version: ctx.app.version,
          }).pipe(Effect.mapError(() => context.error("failed", "Unable to retrieve Kilo transcription models"))),
        "autocomplete.fimTarget": (input) =>
          Effect.sync(() =>
            KiloAutocomplete.resolveFimTarget(input.provider, input.model, catalog.account?.server ?? server),
          ),
        "autocomplete.editTarget": (input) =>
          Effect.sync(() =>
            KiloAutocomplete.resolveEditTarget(input.provider, input.model, catalog.account?.server ?? server),
          ),
        "session.metadata": (input) =>
          Effect.sync(() => sessionMetadata.get(input.sessionID) ?? {}),
      })
      .pipe(Effect.orDie)

    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          (event.type === "credential.switched" && event.data.integrationID === integrationID) ||
          (event.type === OrganizationEvent.type && event.data.source !== instanceID),
      ),
      Stream.runForEach(() => reload),
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
  if (!token) return `catalog:anonymous:${server}`
  const hash = createHash("sha256").update(`${server}:${token}`).digest("hex")
  return `catalog:personal:${hash}`
}

function packageFor(aiSDKProvider?: KiloModels.AISDKProvider): string {
  if (aiSDKProvider === "anthropic") return "@opencode/ai/providers/anthropic"
  if (aiSDKProvider === "openai") return "@opencode/ai/providers/openai"
  if (aiSDKProvider === "openai-compatible") return "@opencode/ai/providers/openai-compatible"
  return "@opencode/ai/providers/openrouter"
}

function toModelInfo(
  source: KiloModels.Model,
  baseURL: string,
  headers: Record<string, string>,
): Model.Info {
  const modelID = Model.ID.make(source.id)
  const pkg = packageFor(source.aiSDKProvider)
  const settings = {
    baseURL,
    ...(pkg === "@opencode/ai/providers/openai-compatible" ? { provider: id } : {}),
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
  const resolvedVariants = source.reasoning ? Variant.resolve(base) : []
  const byID = new Map(resolvedVariants.map((variant) => [variant.id, variant]))
  for (const variant of source.variants ?? []) {
    const variantID = Model.VariantID.make(variant.id)
    byID.set(variantID, {
      id: variantID,
      settings: { ...settings, ...variant.settings },
      headers: { ...headers },
    })
  }
  return {
    ...base,
    variants: [...byID.values()],
  }
}

function device(server: string) {
  return {
    integrationID: id,
    method: { id: methodID, type: "oauth", label: "Kilo Gateway (Device Authorization)" },
    authorize: () =>
      Effect.gen(function* () {
        const code = yield* KiloDevice.start(server)
        return {
          mode: "auto" as const,
          url: code.verificationUrl,
          instructions: `Enter code: ${code.code}`,
          expiresAt: (yield* Clock.currentTimeMillis) + code.expiresIn * 1000,
          callback: Effect.gen(function* () {
            const login = yield* KiloDevice.login(server, code)
            // v1 reuses the token as the refresh token and has no refresh endpoint.
            return Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: login.token,
              refresh: login.token,
              expires: (yield* Clock.currentTimeMillis) + KiloDevice.TOKEN_LIFETIME_MS,
              metadata: { server, organizationID: login.organizationID, email: login.email },
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

function toAccount(credential: Credential.Value, selection: { readonly organizationID: string | null } | undefined) {
  if (credential.type === "external") return undefined
  const metadata = Option.getOrUndefined(decodeMetadata(credential.metadata ?? {}))
  return KiloAccount.resolve({
    token: credential.type === "oauth" ? credential.access : credential.key,
    server: metadata?.server,
    // The team chosen after login wins over the login default.
    organizationID: selection ? selection.organizationID : metadata?.organizationID,
  })
}
