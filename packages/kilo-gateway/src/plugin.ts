import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import type { CatalogEditor } from "@opencode-ai/plugin/effect/catalog"
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
import { catalogEntries, catalogModels, fetchCatalogSource, fetchModelMetadata, type CatalogModel } from "./models.js"
import { clearSnapshot, readSnapshot, scopeIdentity, snapshotLifetime, writeSnapshot } from "./startup-cache.js"
import { registerSessions, type SessionServices } from "./session.js"

export interface GatewayContext {
  readonly location: Context["location"]
  readonly integration: Pick<Context["integration"], "transform" | "connection">
  readonly catalog: Pick<Context["catalog"], "transform" | "reload">
  readonly event: Context["event"]
  readonly rpc: Pick<Context["rpc"], "register">
  readonly session: Pick<Context["session"], "hook">
  /** Host-provided tool registration for optional in-process extensions. */
  readonly tool?: Context["tool"]
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
  readonly identity?: string
  readonly created?: number
  readonly profile?: Profile
  readonly server: string
  readonly organizationID?: string | null
  /** Undefined means the scoped model request failed; never reuse another account's snapshot. */
  readonly models?: readonly CatalogModel[]
  /**
   * No Kilo credential is stored: the catalog was read without `Authorization`
   * and holds only the Gateway's own free-tier records. Signed-in scopes never
   * set this, so an authenticated snapshot can never be mistaken for one.
   */
  readonly anonymous?: true
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
  const configured: { current: ReadonlyMap<string, ReadonlySet<ExplicitField>>; zen: boolean } = {
    current: new Map(),
    zen: false,
  }
  const readEntries = options.configEntries
  const reloadConfigured =
    readEntries === undefined
      ? Effect.void
      : Effect.suspend(() => readEntries(configuredLocation(ctx.location))).pipe(
          Effect.tap((entries) =>
            Effect.sync(() => {
              configured.zen = explicitZen(entries)
            }),
          ),
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
  // Host-bridged data-collection policy, resolved per location from the host's settings fold.
  // `undefined` means no restriction is requested: an unset, explicitly false, invalid, or
  // unreadable setting never invents one. A failed read keeps the last known policy for the
  // same reason the explicit-field map keeps its last value — and the in-memory cell means no
  // per-request settings I/O.
  const policy: { current: "deny" | undefined } = { current: undefined }
  const readPolicy = options.dataCollectionPolicy
  const reloadPolicy =
    readPolicy === undefined
      ? Effect.void
      : Effect.suspend(() => readPolicy(configuredLocation(ctx.location))).pipe(
          Effect.tap((value) =>
            Effect.sync(() => {
              policy.current = value
            }),
          ),
          Effect.catch(() => Effect.void),
          Effect.asVoid,
        )
  const scope = Effect.gen(function* () {
    const connection = yield* ctx.integration.connection.active("kilo")
    if (connection === undefined) return { server, identity: scopeIdentity(server) }
    if (connection.type !== "credential") return yield* Effect.fail(new Error("No active Kilo credential"))
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
    return { server: base, token, organizationID, identity: scopeIdentity(base, token, connection.id, organizationID) }
  })
  const initialize = Effect.gen(function* () {
    const current = yield* scope
    const snapshot = yield* readSnapshot(ctx.storage, current.identity)
    loaded.current = {
      server: current.server,
      identity: current.identity,
      ...(current.token === undefined ? { anonymous: true as const } : {}),
      ...(snapshot
        ? {
            created: snapshot.created,
            profile: snapshot.profile,
            organizationID: snapshot.organizationID,
            models: catalogModels(snapshot.catalog, current.token === undefined),
          }
        : {}),
    }
    loaded.invalid = current.token !== undefined && snapshot === undefined
  }).pipe(
    Effect.catch(() =>
      Effect.sync(() => {
        loaded.current = undefined
        loaded.invalid = true
      }),
    ),
  )
  const refresh = () =>
    loading.withPermit(
      reloadPolicy.pipe(
        Effect.andThen(
          Effect.gen(function* () {
            const current = yield* scope
            const profile = current.token === undefined ? undefined : yield* fetchProfile(current.server, current.token)
            const selected =
              profile === undefined
                ? { currentOrganizationID: null, selectionAvailable: true }
                : resolveSelection(profile, current.organizationID)
            const catalog = selected.selectionAvailable
              ? yield* fetchCatalogSource({
                  server: current.server,
                  token: current.token,
                  organizationID: selected.currentOrganizationID,
                }).pipe(Effect.catch(() => Effect.succeed(undefined)))
              : undefined
            // A credential or selection can change while the network request is pending.
            // Discard that response before it can repopulate the new account's catalog.
            const active = yield* scope
            if (active.identity !== current.identity) return
            const created = Date.now()
            loaded.current = {
              server: current.server,
              identity: current.identity,
              created,
              ...(profile ? { profile } : { anonymous: true as const }),
              ...(selected.selectionAvailable ? { organizationID: selected.currentOrganizationID } : {}),
              ...(catalog ? { models: catalogModels(catalog, current.token === undefined) } : {}),
            }
            loaded.invalid = !selected.selectionAvailable
            if (options.backgroundRefresh) {
              if (catalog && selected.selectionAvailable) {
                yield* writeSnapshot(ctx.storage, {
                  identity: current.identity,
                  created,
                  ...(profile ? { profile } : {}),
                  organizationID: selected.currentOrganizationID,
                  catalog,
                })
              } else if (!selected.selectionAvailable) yield* clearSnapshot(ctx.storage, current.identity)
            }
          }),
        ),
        Effect.catch(() =>
          Effect.gen(function* () {
            loaded.current = undefined
            loaded.invalid = true
            // A failed read disables this Location but does not invalidate another
            // Location's persisted snapshot. Reuse remains identity-bound and expires.
          }),
        ),
        Effect.andThen(() => ctx.catalog.reload()),
      ),
    )
  const cachedAccount = account(ctx, options, registration.method.id, (base, token, connectionID, organizationID) => {
    const current = loaded.current
    if (!options.backgroundRefresh || loaded.invalid || !current?.created || !current.profile) return
    if (current.identity !== scopeIdentity(base, token, connectionID, organizationID)) return
    if (Date.now() - current.created >= snapshotLifetime) return
    return current.profile
  })

  const readAccount = Effect.suspend(() =>
    options.backgroundRefresh && !loaded.current?.profile ? loading.withPermit(cachedAccount) : cachedAccount,
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
        const deny = policy.current === "deny"
        if (isGatewayRequest(event.request, current.server, "/messages")) {
          // The SDK's x-api-key carries the active Kilo key; it must win over any configured or
          // foreign Authorization header, matching v1's unconditional Bearer override. Without a
          // key, an existing Bearer (native OAuth authToken) is preserved untouched.
          const apiKey = event.request.headers.get("x-api-key")
          if (apiKey) event.request.headers.set("authorization", `Bearer ${apiKey}`)
          yield* rewriteGatewayBody(event, deny)
          return
        }
        if (isGatewayRequest(event.request, current.server, "/chat/completions")) {
          yield* rewriteGatewayBody(event, deny)
          return
        }
        if (!isGatewayRequest(event.request, current.server, "/responses")) return
        const text = yield* Effect.promise(() => event.request.clone().text())
        const body = sanitizeResponseBody(text, deny)
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
    const anonymous = loaded.current?.anonymous === true
    const models = loaded.current?.models
    // Signed out, only the fetched free records may be offered, so the read is authoritative
    // even when it is empty or failed: an unbounded seed catalog would otherwise stay enabled
    // and carry the anonymous key onto models the free tier cannot execute.
    const free = anonymous ? new Set((models ?? []).map((model) => model.id)) : undefined
    editor.provider.update("kilo", (provider) => {
      provider.settings = { ...provider.settings, baseURL }
      provider.headers = headers(provider.headers)
      // Configured endpoints can already activate the provider before this transform.
      // Withdraw it too when the signed-out catalog offers nothing executable.
      if (loaded.invalid || free?.size === 0) provider.activation = "disabled"
      // Signed out, the integration has no connection, so host availability would hide the
      // provider (`available()` in the host catalog requires a connection for a bound
      // integration). The free tier is usable without one, so activate it and send the v1
      // anonymous key (origin/main ecccd1f, kilo-gateway/src/api/constants.ts:58 and
      // src/loader.ts:21). An explicitly disabled provider stays disabled, and a scope with no
      // free models is not activated at all.
      if (free?.size && !loaded.invalid && provider.activation !== "disabled") {
        provider.activation = "enabled"
        provider.settings = { ...provider.settings, apiKey: anonymousKey }
      }
    })
    // Signed out of Kilo, the fork's own free tier replaces the host's uncredentialed Zen
    // offer, so the withdrawal cannot depend on this read succeeding: an empty or failed Kilo
    // catalog must not let Zen become the automatic fallback.
    if (anonymous) suppressUncredentialedZen(editor, configured.zen)
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
        if (free !== undefined && !loaded.invalid) model.enabled = !disabled.has(id) && free.has(id)
        else if (!loaded.invalid && !disabled.has(id) && (team || replace))
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
      readAccount.pipe(
        Effect.map((value) => value.view),
        Effect.mapError((error) =>
          error.type === "kilocode.gateway"
            ? call.error(error.type, error.message)
            : call.error(error.type, error.message),
        ),
        (effect) => selection.withPermit(effect),
      ),
    balance: (_, call) =>
      readAccount.pipe(
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
      // Signed out, the loaded scope is the public free catalog: serve its metadata from that
      // snapshot instead of requiring an account, so free models keep their catalog metadata
      // without a second unauthenticated read.
      (options.backgroundRefresh
        ? Effect.gen(function* () {
            const current = yield* scope
            if (current.identity !== loaded.current?.identity || loaded.invalid) {
              return yield* Effect.fail(unavailable("Kilo models are still loading"))
            }
            if (loaded.current.created !== undefined && Date.now() - loaded.current.created >= snapshotLifetime) {
              yield* refresh()
            }
            if (current.identity !== loaded.current?.identity || loaded.invalid) {
              return yield* Effect.fail(unavailable("Unable to retrieve Kilo model metadata"))
            }
            return catalogEntries(loaded.current.models ?? [])
          }).pipe(Effect.mapError(() => unavailable("Unable to retrieve Kilo model metadata")))
        : loaded.current?.anonymous === true
          ? Effect.succeed(catalogEntries(loaded.current.models ?? []))
          : account(ctx, options, registration.method.id).pipe(
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
            )
      ).pipe(
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
    Stream.runForEach(() =>
      Effect.gen(function* () {
        // Withdraw the old scope before waiting for a possibly slow refresh.
        if (options.backgroundRefresh) {
          yield* initialize
          yield* ctx.catalog.reload()
        }
        yield* refresh()
      }),
    ),
    Effect.forkScoped({ startImmediately: true }),
  )
  // ConfigProvider independently reloads the catalog on config.updated; this subscription keeps
  // the explicit-field map fresh and reloads again so the rebuild can never apply stale fields.
  yield* ctx.event.subscribe().pipe(
    Stream.filter((event) => event.type === "config.updated"),
    Stream.runForEach(() => reloadPolicy.pipe(Effect.andThen(reloadConfigured), Effect.andThen(ctx.catalog.reload()))),
    Effect.forkScoped({ startImmediately: true }),
  )
  yield* reloadConfigured
  // Register this Location's prompt-selector reader with the host. The Gateway activates per
  // Location and each activation owns its `loaded` cache, so the reader closes over *this*
  // activation's cache and is keyed by this Location; the host attaches removal to the
  // registration scope so a torn-down Location cannot leave (or clobber a successor's) reader.
  // The reader reads the in-memory cache only and reports no selector whenever the cache is
  // absent (failed or revoked scope), matching how the catalog transform treats it.
  if (options.promptSelector) {
    const selector = options.promptSelector
    yield* selector.register(
      configuredLocation(ctx.location),
      (modelID) => loaded.current?.models?.find((model) => model.id === modelID)?.prompt,
    )
  }
  if (runtime) {
    const release = runtime.register(refresh)
    yield* Effect.addFinalizer(() => Effect.sync(release))
  }
  if (options.backgroundRefresh) {
    yield* reloadPolicy
    yield* initialize
    yield* ctx.catalog.reload()
    // Cold sessions (including restart recovery) need the catalog before model resolution.
    // A matching warm snapshot can execute immediately while its replacement loads.
    if (loaded.current?.models !== undefined) {
      yield* Effect.forkScoped(refresh(), { startImmediately: true })
      return
    }
    yield* refresh()
    return
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
/**
 * v1's anonymous inference key (`origin/main` `ecccd1f`,
 * `packages/kilo-gateway/src/api/constants.ts:58`, applied in `src/loader.ts:21,34` and
 * `packages/opencode/src/kilocode/provider/provider.ts:221`).
 */
const anonymousKey = "anonymous"

/**
 * The host ships an uncredentialed OpenCode Zen free tier: with no key it forces
 * `activation: "enabled"` and `settings.apiKey: "public"`, then disables its paid models
 * (`packages/core/src/plugin/provider/opencode.ts:188-203`). Signed out of Kilo, that default
 * competes with Kilo's own free tier for the automatic model choice, so this fork withdraws
 * only that automatic offer.
 *
 * Suppression requires the host's own uncredentialed marker (`apiKey === "public"`, which it
 * sets only when there is no env key, no connection, and no configured key), so a connected,
 * env-keyed, or key-configured Zen is never touched. A configuration that asks for Zen — an
 * `opencode` provider block carrying a key or `env` — also keeps it. A bare `providers.opencode`
 * block that only names models is not read as asking for the anonymous tier.
 */
function suppressUncredentialedZen(editor: CatalogEditor, zenConfigured: boolean) {
  const item = editor.provider.get("opencode")
  if (!item) return
  if (item.provider.activation === "disabled") return
  if (item.provider.settings?.apiKey !== "public") return
  if (zenConfigured) return
  editor.provider.update("opencode", (provider) => {
    provider.activation = "disabled"
  })
}

/**
 * Whether any configuration document asks for the OpenCode provider with credentials of its
 * own. Naming models alone does not, so the host's anonymous tier stays suppressible.
 */
function explicitZen(entries: readonly Config.Entry[]): boolean {
  return entries.some((entry) => {
    if (entry.type !== "document") return false
    const provider = entry.info.providers?.["opencode"]
    if (!provider) return false
    const settings = provider.settings as { readonly apiKey?: unknown } | undefined
    return settings?.apiKey !== undefined || (provider.env?.length ?? 0) > 0
  })
}

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

function isGatewayRequest(
  request: Request,
  server: string,
  endpoint: "/messages" | "/responses" | "/chat/completions",
) {
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

const rewriteGatewayBody = (event: { request: Request }, deny: boolean) =>
  Effect.gen(function* () {
    const text = yield* Effect.promise(() => event.request.clone().text())
    const data = Option.getOrUndefined(decodeJson(text))
    if (!record(data)) return
    const stripped = Object.fromEntries(Object.entries(data).filter(([key]) => !accountBodyKeys.has(key)))
    const accountChanged = Object.keys(stripped).length !== Object.keys(data).length
    if (!accountChanged && (!deny || dataCollectionApplied(data))) return
    event.request.headers.delete("content-length")
    // oxlint-disable-next-line unicorn/no-invalid-fetch-options
    event.request = new Request(event.request, { body: JSON.stringify(injectDataCollection(stripped, deny)) })
  })

// Data-collection policy injection, mirroring v1 `transformRequestBody` (origin/main ecccd1f,
// kilo-gateway/src/responses.ts): an existing record `provider` keeps its routing fields, while
// a missing or non-record `provider` becomes exactly `{ data_collection: "deny" }`.
function injectDataCollection(body: Record<string, unknown>, deny: boolean) {
  if (!deny) return body
  const provider = record(body.provider) ? body.provider : {}
  return { ...body, provider: { ...provider, data_collection: "deny" } }
}

function dataCollectionApplied(body: Record<string, unknown>) {
  return record(body.provider) && body.provider.data_collection === "deny"
}

// Source contract: origin/main ecccd1f, kilo-gateway/src/responses.ts.
// Stateless Responses calls cannot refer back to previous response items. Reserved account
// fields are stripped on every request — a stored conversation is not a credential-hygiene
// exemption — while item-reference rewriting stays limited to stateless calls.
function sanitizeResponseBody(text: string, deny: boolean): string | undefined {
  const data = Option.getOrUndefined(decodeJson(text))
  if (!record(data)) return undefined
  const stripped = Object.fromEntries(Object.entries(data).filter(([key]) => !accountBodyKeys.has(key)))
  const accountChanged = Object.keys(stripped).length !== Object.keys(data).length
  const policyChanged = deny && !dataCollectionApplied(data)
  if (data.store === true || !Array.isArray(data.input)) {
    if (!accountChanged && !policyChanged) return undefined
    return JSON.stringify(injectDataCollection(stripped, deny))
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
  if (!accountChanged && !referencesChanged && !policyChanged) return undefined
  return JSON.stringify({ ...injectDataCollection(stripped, deny), input })
}

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function account(
  ctx: GatewayContext,
  options: GatewayOptions,
  oauthMethodID: string,
  cached?: (server: string, token: string, connectionID: string, organizationID?: string | null) => Profile | undefined,
) {
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
    const stored = yield* ctx.storage
      .get(selectionKey(connection.id))
      .pipe(Effect.mapError(() => unavailable("Unable to read the Kilo account selection")))
    const selected =
      stored === undefined
        ? metadata.organizationID
        : (yield* Schema.decodeUnknownEffect(StoredSelection)(stored).pipe(
            Effect.mapError(() => invalid("The Kilo account selection is invalid")),
          )).organizationID
    const profile =
      cached?.(base, token, connection.id, selected) ??
      (yield* fetchProfile(base, token).pipe(Effect.mapError(() => unavailable("Unable to retrieve the Kilo profile"))))
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
