import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import type { Config } from "@opencode-ai/schema/config"
import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import type { Location } from "@opencode-ai/schema/location"
import { Effect, Exit, Option, Schema, Scope, Semaphore, Stream } from "effect"
import {
  defaultOrganizationID,
  deviceAuth,
  fetchProfile,
  serverUrl,
  type GatewayOptions,
  type Profile,
} from "./gateway.js"
import { fetchAccountBalance } from "./account.js"
import { fetchCatalogModels, fetchModelMetadata, type CatalogModel } from "./models.js"
import { registerSessions, type SessionServices } from "./session.js"

export interface GatewayContext {
  readonly location: Context["location"]
  readonly integration: Pick<Context["integration"], "transform" | "connection">
  readonly catalog: Pick<Context["catalog"], "transform" | "reload">
  readonly event: Context["event"]
  readonly rpc: Pick<Context["rpc"], "register">
  readonly session: Pick<Context["session"], "hook">
  readonly storage: Pick<Context["storage"], "get" | "set" | "remove">
}

const Selection = Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))
const StoredSelection = Schema.Struct({ organizationID: Selection })
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Selection),
})
const organizationHeader = "X-KILOCODE-ORGANIZATIONID"
const decodeJson = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))

type Loaded = {
  readonly server: string
  readonly organizationID?: string | null
  /** Undefined means the scoped model request failed; never reuse another account's snapshot. */
  readonly models?: readonly CatalogModel[]
}

type AccountFailure =
  | { readonly type: "kilocode.gateway"; readonly message: string }
  | { readonly type: "kilocode.gateway_unavailable"; readonly message: string }

/**
 * Config-document model fields the Gateway must never overwrite with API catalog values.
 * Ownership granularity mirrors the host config fold: `name`, whole `cost`, whole
 * `capabilities`, and each `limit` subfield independently (the fold shallow-merges limit).
 */
type ExplicitField = "name" | "cost" | "capabilities" | "limit.context" | "limit.input" | "limit.output"

export interface GatewayAccount {
  readonly token: string
  readonly server: string
  readonly organizationID: string | null
}

// In-process only. Extensions perform authenticated operations inside the host;
// this resolver is never exposed as an RPC that could export credentials.
export type GatewayExtension = (
  ctx: GatewayContext,
  account: Effect.Effect<GatewayAccount, AccountFailure>,
) => Effect.Effect<void, unknown, Scope.Scope>

export function createGatewayPlugin(
  options: GatewayOptions = {},
  services?: SessionServices,
  extension?: GatewayExtension,
) {
  const refreshers = new Set<() => Effect.Effect<void>>()
  const selection = Semaphore.makeUnsafe(1)
  const refresh = Effect.suspend(() =>
    Effect.forEach(refreshers, (reload) => reload(), { concurrency: "unbounded", discard: true }),
  )
  return define({
    id: "kilocode.gateway",
    effect: (ctx) =>
      registerGateway(
        ctx,
        options,
        {
          selection,
          refresh,
          register: (reload) => {
            refreshers.add(reload)
            return () => {
              refreshers.delete(reload)
            }
          },
        },
        services,
        extension,
      ).pipe(Effect.orDie),
  })
}

type Runtime = {
  readonly selection: Semaphore.Semaphore
  readonly refresh: Effect.Effect<void>
  readonly register: (refresh: () => Effect.Effect<void>) => () => void
}

export const registerGateway = Effect.fn(function* (
  ctx: GatewayContext,
  options: GatewayOptions = {},
  runtime?: Runtime,
  services?: SessionServices,
  extension?: GatewayExtension,
) {
  const registration = deviceAuth(options)
  const server = serverUrl(options.server)
  const loaded: { current?: Loaded; invalid: boolean } = { invalid: false }
  const loading = Semaphore.makeUnsafe(1)
  const selection = runtime?.selection ?? Semaphore.makeUnsafe(1)
  // Explicit config model fields win over API catalog enrichment, matching the v1 config fold.
  // The Config service is location-scoped and unreachable from the plugin Context, so the host
  // injects an entries reader; the map refreshes on config.updated before the catalog rebuild.
  const configured: { current: ReadonlyMap<string, ReadonlySet<ExplicitField>> } = { current: new Map() }
  const readEntries = options.configEntries
  const reloadConfigured =
    readEntries === undefined
      ? Effect.void
      : Effect.suspend(() => readEntries(configuredLocation(ctx.location))).pipe(
          Effect.map(explicitFields),
          Effect.tap((fields) =>
            Effect.sync(() => {
              configured.current = fields
            }),
          ),
          // A failed read keeps the last known map rather than dropping explicit-field protection.
          Effect.catch(() => Effect.void),
          Effect.asVoid,
        )
  const refresh = () =>
    loading.withPermit(
      Effect.gen(function* () {
        const connection = yield* ctx.integration.connection.active("kilo")
        if (connection?.type !== "credential") return yield* Effect.fail(new Error("No active Kilo credential"))
        const credential = yield* ctx.integration.connection.resolve(connection)
        if (!credential) return yield* Effect.fail(new Error("Unable to resolve the active Kilo credential"))
        if (credential.type === "oauth" && credential.methodID !== registration.method.id) {
          return yield* Effect.fail(new Error("Unsupported Kilo sign-in method"))
        }
        const metadata = yield* Schema.decodeUnknownEffect(Metadata)(credential.metadata ?? {})
        const stored = yield* ctx.storage.get(selectionKey(connection.id))
        const organizationID =
          stored === undefined
            ? metadata.organizationID
            : (yield* Schema.decodeUnknownEffect(StoredSelection)(stored)).organizationID
        const base = yield* Effect.try(() => serverUrl(metadata.server ?? options.server))
        const token = credential.type === "oauth" ? credential.access : credential.key
        const selected = resolveSelection(yield* fetchProfile(base, token), organizationID)
        const current = {
          current: {
            server: base,
            ...(selected.selectionAvailable ? { organizationID: selected.currentOrganizationID } : {}),
          },
          invalid: !selected.selectionAvailable,
        }
        if (!selected.selectionAvailable) return current
        const models = yield* fetchCatalogModels({
          token,
          server: base,
          organizationID: selected.currentOrganizationID,
        }).pipe(Effect.catch(() => Effect.succeed(undefined)))
        return { ...current, current: { ...current.current, ...(models === undefined ? {} : { models }) } }
      }).pipe(
        Effect.exit,
        Effect.tap((result) =>
          Effect.sync(() => {
            if (Exit.isFailure(result)) {
              loaded.current = undefined
              loaded.invalid = true
              return
            }
            loaded.current = result.value.current
            loaded.invalid = result.value.invalid
          }),
        ),
        Effect.andThen(() => ctx.catalog.reload()),
      ),
    )

  if (extension) {
    yield* extension(
      ctx,
      selection.withPermit(
        account(ctx, options, registration.method.id).pipe(
          Effect.flatMap((current) =>
            current.view.selectionAvailable
              ? Effect.succeed({
                  token: current.token,
                  server: current.server,
                  organizationID: current.view.currentOrganizationID,
                })
              : Effect.fail(invalid("The selected Kilo account is not available")),
          ),
        ),
      ),
    )
  }

  yield* ctx.session.hook(
    "http.request",
    (event) =>
      Effect.gen(function* () {
        const current = loaded.current
        if (loaded.invalid || !current) return
        if (isGatewayRequest(event.request, current.server, "/messages")) {
          // The SDK's x-api-key carries the active Kilo key; it must win over any configured or
          // foreign Authorization header, matching v1's unconditional Bearer override. Without a
          // key, an existing Bearer (native OAuth authToken) is preserved untouched.
          const apiKey = event.request.headers.get("x-api-key")
          if (apiKey) event.request.headers.set("authorization", `Bearer ${apiKey}`)
          yield* stripAccountFields(event)
          return
        }
        if (isGatewayRequest(event.request, current.server, "/chat/completions")) {
          yield* stripAccountFields(event)
          return
        }
        if (!isGatewayRequest(event.request, current.server, "/responses")) return
        const text = yield* Effect.promise(() => event.request.clone().text())
        const body = sanitizeResponseBody(text)
        if (body === undefined) return
        event.request.headers.delete("content-length")
        // The pinned Responses endpoint only accepts POST; Request preserves its existing method and headers.
        // oxlint-disable-next-line unicorn/no-invalid-fetch-options
        event.request = new Request(event.request, { body })
      }),
    { providerID: "kilo" },
  )

  yield* ctx.integration.transform((editor) => {
    editor.update("kilo", (integration) => {
      integration.name = "Kilo Gateway"
    })
    editor.method.update(registration)
  })
  yield* ctx.catalog.transform((editor) => {
    const item = editor.provider.get("kilo")
    if (!item || (item.provider.integrationID !== undefined && item.provider.integrationID !== "kilo")) return
    const baseURL = `${loaded.current?.server ?? server}/api/gateway`
    const headers = (input: Record<string, string> = {}) => ({
      ...Object.fromEntries(
        Object.entries(input).filter(([key]) => key.toLowerCase() !== organizationHeader.toLowerCase()),
      ),
      ...(loaded.current?.organizationID ? { [organizationHeader]: loaded.current.organizationID } : {}),
    })
    editor.provider.update("kilo", (provider) => {
      provider.settings = { ...provider.settings, baseURL }
      provider.headers = headers(provider.headers)
      if (loaded.invalid) provider.activation = "disabled"
    })
    const models = loaded.current?.models
    const team = loaded.current?.organizationID !== null && loaded.current?.organizationID !== undefined
    const replace = models !== undefined && (team || models.length > 0)
    const disabled = new Set([...item.models].flatMap(([id, model]) => (model.enabled ? [] : [id])))
    item.models.forEach((_, id) => {
      editor.model.update("kilo", id, (model) => {
        model.settings = { ...model.settings, baseURL }
        model.headers = headers(model.headers)
        model.variants?.forEach((variant) => {
          variant.settings = { ...variant.settings, baseURL }
          variant.headers = headers(variant.headers)
        })
        if (loaded.invalid) model.enabled = false
        if (!loaded.invalid && !disabled.has(id) && (team || replace))
          model.enabled = models?.some((item) => item.id === id) ?? false
      })
    })
    if (loaded.invalid || models === undefined) return
    for (const source of models) {
      editor.model.update("kilo", source.id, (model) => {
        const explicit = configured.current.get(source.id)
        if (explicit?.has("name") !== true) model.name = source.name
        model.package ??= packageFor(source.aiSDKProvider)
        model.settings = { ...model.settings, baseURL }
        model.headers = headers(model.headers)
        if (!disabled.has(source.id)) model.enabled = true
        if (source.limit) {
          if (explicit?.has("limit.context") !== true) model.limit.context = source.limit.context
          if (explicit?.has("limit.output") !== true) model.limit.output = source.limit.output
        }
        if (source.cost && explicit?.has("cost") !== true) model.cost = [source.cost]
        if (source.capabilities && explicit?.has("capabilities") !== true) model.capabilities = source.capabilities
        if (source.variants) {
          const variants = new Map(source.variants.map((item) => [item.id, item]))
          model.variants.forEach((item) => variants.set(item.id, item))
          model.variants = [...variants.values()]
        }
      })
    }
  })
  yield* ctx.rpc.register(KiloGateway.Definition, {
    profile: (_, call) =>
      account(ctx, options, registration.method.id).pipe(
        Effect.map((value) => value.view),
        Effect.mapError((error) =>
          error.type === "kilocode.gateway"
            ? call.error(error.type, error.message)
            : call.error(error.type, error.message),
        ),
        (effect) => selection.withPermit(effect),
      ),
    balance: (_, call) =>
      account(ctx, options, registration.method.id).pipe(
        Effect.flatMap((current) => {
          if (!current.view.selectionAvailable) {
            return Effect.fail(invalid("The selected Kilo account is not available"))
          }
          return fetchAccountBalance(current.server, current.token, current.view.currentOrganizationID).pipe(
            Effect.map((value) =>
              KiloGateway.AccountBalance.make({ ...value, currentOrganizationID: current.view.currentOrganizationID }),
            ),
          )
        }),
        Effect.mapError((error) => call.error(error.type, error.message)),
        (effect) => selection.withPermit(effect),
      ),
    "organization.set": (input, call) =>
      Effect.gen(function* () {
        const current = yield* account(ctx, options, registration.method.id).pipe(
          Effect.mapError((error) =>
            error.type === "kilocode.gateway"
              ? call.error(error.type, error.message)
              : call.error(error.type, error.message),
          ),
        )
        const organization = current.profile.organizations.find((item) => item.id === input.organizationID)
        if (input.organizationID !== null && !organization) {
          return yield* Effect.fail(call.error("kilocode.gateway", "The selected Kilo organization is not available"))
        }
        if (input.organizationID === null && current.profile.hasPersonalAccount === false) {
          return yield* Effect.fail(call.error("kilocode.gateway", "This Kilo account has no personal account"))
        }
        const key = selectionKey(current.connectionID)
        return yield* Effect.gen(function* () {
          const previous = yield* ctx.storage
            .get(key)
            .pipe(
              Effect.mapError(() =>
                call.error("kilocode.gateway_unavailable", "Unable to read the Kilo account selection"),
              ),
            )
          yield* ctx.storage
            .set(key, { organizationID: input.organizationID })
            .pipe(
              Effect.mapError(() =>
                call.error("kilocode.gateway_unavailable", "Unable to save the Kilo account selection"),
              ),
            )
          const synchronized = yield* Effect.exit(runtime?.refresh ?? refresh())
          if (Exit.isFailure(synchronized)) {
            const restored = yield* Effect.exit(
              (previous === undefined ? ctx.storage.remove(key) : ctx.storage.set(key, previous)).pipe(
                Effect.andThen(runtime?.refresh ?? refresh()),
              ),
            )
            return yield* Effect.fail(
              call.error(
                "kilocode.gateway_unavailable",
                Exit.isSuccess(restored)
                  ? "Kilo account change failed; the previous selection was restored"
                  : "Kilo account change failed and the previous selection could not be fully restored. Restart the preview before continuing",
              ),
            )
          }
          return KiloGateway.Account.make({
            profile: current.profile,
            currentOrganizationID: input.organizationID,
            selectionAvailable: true,
          })
        }).pipe(Effect.uninterruptible)
      }).pipe((effect) => selection.withPermit(effect)),
  })
  yield* ctx.rpc.register(KiloModels.Definition, {
    list: (_, call) =>
      account(ctx, options, registration.method.id).pipe(
        Effect.flatMap((current) => {
          if (!current.view.selectionAvailable) {
            return Effect.fail(invalid("The selected Kilo account is not available"))
          }
          return fetchModelMetadata({
            token: current.token,
            server: current.server,
            organizationID: current.view.currentOrganizationID,
          }).pipe(Effect.mapError(() => unavailable("Unable to retrieve Kilo model metadata")))
        }),
        Effect.mapError((error) => call.error(error.type, error.message)),
        (effect) => selection.withPermit(effect),
      ),
  })
  yield* registerSessions(
    ctx,
    options,
    registration.method.id,
    services,
    Effect.gen(function* () {
      const current = yield* account(ctx, options, registration.method.id).pipe(
        Effect.mapError((error) => error.message),
      )
      if (!current.view.selectionAvailable) {
        return yield* Effect.fail("The selected Kilo account is not available")
      }
      if (current.view.currentOrganizationID !== null) {
        // Bootstrap defaults to personal ownership; team claims require a separate, validated ingest item.
        return yield* Effect.fail("Team session sharing is not supported in this preview yet")
      }
      return yield* Effect.void
    }),
  )
  yield* ctx.event.subscribe().pipe(
    Stream.filter(
      (event) =>
        event.type === "credential.updated" ||
        (event.type === "credential.switched" && event.data.integrationID === "kilo"),
    ),
    Stream.runForEach(refresh),
    Effect.forkScoped({ startImmediately: true }),
  )
  // ConfigProvider independently reloads the catalog on config.updated; this subscription keeps
  // the explicit-field map fresh and reloads again so the rebuild can never apply stale fields.
  yield* ctx.event.subscribe().pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() => reloadConfigured.pipe(Effect.andThen(ctx.catalog.reload()))),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* reloadConfigured
  if (runtime) {
    const release = runtime.register(refresh)
    yield* Effect.addFinalizer(() => Effect.sync(release))
  }
  yield* refresh()
})

function configuredLocation(location: GatewayContext["location"]): Location.Ref {
  return {
    directory: location.directory,
    ...(location.workspaceID === undefined ? {} : { workspaceID: location.workspaceID }),
  }
}

// Fold config documents (lowest to highest priority) into the set of model fields any document
// explicitly configures. A field set in any document participates in the host's config fold, so
// the Gateway must preserve it rather than overwrite it with the current account's API values.
function explicitFields(entries: readonly Config.Entry[]): ReadonlyMap<string, ReadonlySet<ExplicitField>> {
  const map = new Map<string, Set<ExplicitField>>()
  for (const entry of entries) {
    if (entry.type !== "document") continue
    const kilo = entry.info.providers?.["kilo"]
    if (!kilo?.models) continue
    for (const [id, model] of Object.entries(kilo.models)) {
      const fields = map.get(id) ?? new Set<ExplicitField>()
      if (model.name !== undefined) fields.add("name")
      if (model.limit?.context !== undefined) fields.add("limit.context")
      if (model.limit?.input !== undefined) fields.add("limit.input")
      if (model.limit?.output !== undefined) fields.add("limit.output")
      if (model.cost !== undefined) fields.add("cost")
      if (model.capabilities !== undefined) fields.add("capabilities")
      if (fields.size > 0) map.set(id, fields)
    }
  }
  return map
}

function packageFor(provider: CatalogModel["aiSDKProvider"]) {
  if (provider === "anthropic") return "aisdk:@ai-sdk/anthropic"
  if (provider === "openai") return "aisdk:@ai-sdk/openai"
  if (provider === "openai-compatible") return "aisdk:@ai-sdk/openai-compatible"
  return "aisdk:@openrouter/ai-sdk-provider"
}

function isGatewayRequest(request: Request, server: string, endpoint: "/messages" | "/responses" | "/chat/completions") {
  if (request.method !== "POST") return false
  const expected = new URL(server)
  expected.pathname = `${expected.pathname.replace(/\/+$/, "")}/api/gateway${endpoint}`
  const actual = new URL(request.url)
  return actual.origin === expected.origin && actual.pathname === expected.pathname
}

// Core's model-resolver merges credential metadata into model settings and (for key credentials)
// the model body overlay before any provider adapter serializes the request; the Kilo account
// payload (profile fields plus server/organizationID written by device auth) must never leave the
// host in a Gateway request body. Strip this closed reserved set at the top level only, after
// serialization: nested provider routing (`provider`, `models`), BYOK (`api_keys` header payloads),
// reasoning payloads, and arbitrary user content stay untouched. Keep in sync with the same closed
// set in packages/ai/src/kilocode/openrouter-routed.ts — the package boundary prevents sharing it.
// Collision: a deliberately configured top-level `user` or `name` request-body field would also be
// removed. Neither is a supported Kilo Gateway dialect field (the OpenRouter wrapper no longer
// forwards source `user`, and account identification is the credential itself), so the reserved
// set wins over the undocumented configured-field case.
const accountBodyKeys = new Set([
  "access",
  "apiKey",
  "authToken",
  "email",
  "hasPersonalAccount",
  "key",
  "name",
  "organizationID",
  "organizationName",
  "organizations",
  "refresh",
  "selectedOrganizationId",
  "server",
  "token",
  "user",
])

const stripAccountFields = (event: { request: Request }) =>
  Effect.gen(function* () {
    const text = yield* Effect.promise(() => event.request.clone().text())
    const data = Option.getOrUndefined(decodeJson(text))
    if (!record(data)) return
    const body = Object.fromEntries(Object.entries(data).filter(([key]) => !accountBodyKeys.has(key)))
    if (Object.keys(body).length === Object.keys(data).length) return
    event.request.headers.delete("content-length")
    // oxlint-disable-next-line unicorn/no-invalid-fetch-options
    event.request = new Request(event.request, { body: JSON.stringify(body) })
  })

// Source contract: origin/main ecccd1f, kilo-gateway/src/responses.ts.
// Stateless Responses calls cannot refer back to previous response items. Reserved account
// fields are stripped on every request — a stored conversation is not a credential-hygiene
// exemption — while item-reference rewriting stays limited to stateless calls.
function sanitizeResponseBody(text: string): string | undefined {
  const data = Option.getOrUndefined(decodeJson(text))
  if (!record(data)) return undefined
  const stripped = Object.fromEntries(Object.entries(data).filter(([key]) => !accountBodyKeys.has(key)))
  const accountChanged = Object.keys(stripped).length !== Object.keys(data).length
  if (data.store === true || !Array.isArray(data.input)) {
    return accountChanged ? JSON.stringify(stripped) : undefined
  }
  const source = data.input
  const input = source.flatMap((item) => {
    if (!record(item)) return [item]
    if (item.type === "item_reference") return []
    if (!("id" in item)) return [item]
    const next = { ...item }
    delete next.id
    return [next]
  })
  const referencesChanged = input.length !== source.length || input.some((item, index) => item !== source[index])
  if (!accountChanged && !referencesChanged) return undefined
  return JSON.stringify({ ...stripped, input })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function account(ctx: GatewayContext, options: GatewayOptions, oauthMethodID: string) {
  return Effect.gen(function* () {
    const connection = yield* ctx.integration.connection
      .active("kilo")
      .pipe(Effect.mapError(() => unavailable("Unable to read the active Kilo account")))
    const credential =
      connection?.type === "credential"
        ? yield* ctx.integration.connection
            .resolve(connection)
            .pipe(Effect.mapError(() => unavailable("Unable to read the active Kilo credential")))
        : undefined
    if (connection?.type !== "credential" || !credential) {
      return yield* Effect.fail(invalid("Sign in with Kilo before selecting an account"))
    }
    if (credential.type === "oauth" && credential.methodID !== oauthMethodID) {
      return yield* Effect.fail(invalid("The active Kilo credential uses an unsupported sign-in method"))
    }
    const token = credential.type === "oauth" ? credential.access : credential.key
    const metadata = yield* Schema.decodeUnknownEffect(Metadata)(credential.metadata ?? {}).pipe(
      Effect.mapError(() => invalid("The Kilo credential metadata is invalid")),
    )
    const base = yield* Effect.try({
      try: () => serverUrl(metadata.server ?? options.server),
      catch: () => invalid("The Kilo server URL is invalid"),
    })
    const profile = yield* fetchProfile(base, token).pipe(
      Effect.mapError(() => unavailable("Unable to retrieve the Kilo profile")),
    )
    const stored = yield* ctx.storage
      .get(selectionKey(connection.id))
      .pipe(Effect.mapError(() => unavailable("Unable to read the Kilo account selection")))
    const selected =
      stored === undefined
        ? metadata.organizationID
        : (yield* Schema.decodeUnknownEffect(StoredSelection)(stored).pipe(
            Effect.mapError(() => invalid("The Kilo account selection is invalid")),
          )).organizationID
    const selection = yield* Effect.try({
      try: () => resolveSelection(profile, selected),
      catch: () => invalid("The Kilo account selection is invalid"),
    })
    return {
      connectionID: connection.id,
      token,
      server: base,
      profile,
      view: KiloGateway.Account.make({ profile, ...selection }),
    }
  })
}

function resolveSelection(profile: Profile, selected: string | null | undefined) {
  const currentOrganizationID = selected === undefined ? defaultOrganizationID(profile) : selected
  const selectionAvailable =
    currentOrganizationID === null
      ? profile.hasPersonalAccount !== false
      : profile.organizations.some((organization) => organization.id === currentOrganizationID)
  return { currentOrganizationID, selectionAvailable }
}

function invalid(message: string): AccountFailure {
  return { type: "kilocode.gateway", message }
}

function unavailable(message: string): AccountFailure {
  return { type: "kilocode.gateway_unavailable", message }
}

function selectionKey(connectionID: string) {
  return `organization:${connectionID}`
}
