import type { Context } from "@opencode-ai/plugin/effect/plugin"
import { define } from "@opencode-ai/plugin/effect/plugin"
import { KiloGateway } from "@opencode-ai/schema/kilocode/gateway"
import { KiloModels } from "@opencode-ai/schema/kilocode/models"
import { Effect, Exit, Schema, Scope, Semaphore, Stream } from "effect"
import {
  defaultOrganizationID,
  deviceAuth,
  fetchProfile,
  serverUrl,
  type GatewayOptions,
  type Profile,
} from "./gateway.js"
import { fetchAccountBalance } from "./account.js"
import { fetchModelMetadata } from "./models.js"
import { registerSessions, type SessionServices } from "./session.js"

export interface GatewayContext {
  readonly location: Context["location"]
  readonly integration: Pick<Context["integration"], "transform" | "connection">
  readonly catalog: Pick<Context["catalog"], "transform" | "reload">
  readonly event: Context["event"]
  readonly rpc: Pick<Context["rpc"], "register">
  readonly storage: Pick<Context["storage"], "get" | "set" | "remove">
}

const Selection = Schema.NullOr(Schema.String.check(Schema.isMinLength(1)))
const StoredSelection = Schema.Struct({ organizationID: Selection })
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Selection),
})
const organizationHeader = "X-KILOCODE-ORGANIZATIONID"

type Loaded = {
  readonly server: string
  readonly organizationID?: string | null
}

type AccountFailure =
  | { readonly type: "kilocode.gateway"; readonly message: string }
  | { readonly type: "kilocode.gateway_unavailable"; readonly message: string }

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
        return {
          current: {
            server: base,
            ...(selected.selectionAvailable ? { organizationID: selected.currentOrganizationID } : {}),
          },
          invalid: !selected.selectionAvailable,
        }
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
    item.models.forEach((_, id) => {
      editor.model.update("kilo", id, (model) => {
        model.settings = { ...model.settings, baseURL }
        model.headers = headers(model.headers)
        model.variants?.forEach((variant) => {
          variant.settings = { ...variant.settings, baseURL }
          variant.headers = headers(variant.headers)
        })
        if (loaded.invalid) model.enabled = false
      })
    })
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
  if (runtime) {
    const release = runtime.register(refresh)
    yield* Effect.addFinalizer(() => Effect.sync(release))
  }
  yield* refresh()
})

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
