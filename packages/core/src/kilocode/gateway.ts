import { KiloAccount, KiloDevice, KiloHeaders, KiloProfile, KiloServer } from "@kilocode/gateway-core"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Clock, Effect, Option, Schema, Scope, Stream } from "effect"
import { Bus } from "../bus.js"
import { KiloGatewayRpc } from "./gateway-rpc.js"

// v2 adapter for the Kilo Gateway (issue #14991, PR 1: login and teams).
// Kilo logic lives in @kilocode/gateway-core; this file only maps it onto the public plugin API.
// The `kilo` integration and provider come from the models.dev seed.
const id = "kilo"
const methodID = IntegrationMethodID.make("device")

// Written by the device method. Decoded again because stored credentials are read back from the database.
const Metadata = Schema.Struct({
  server: Schema.optional(Schema.String),
  organizationID: Schema.optional(Schema.NullOr(Schema.String)),
})
const decodeMetadata = Schema.decodeUnknownOption(Metadata)
// The team choice in plugin storage. `null` is the personal account.
const decodeSelection = Schema.decodeUnknownOption(Schema.Struct({ organizationID: Schema.NullOr(Schema.String) }))
// Published on the global bus (`{ global: true }`), so plugin instances of other locations also reload.
const OrganizationEvent = Bus.ephemeral({
  type: `rpc.${KiloGatewayRpc.Definition.id}.organization`,
  schema: { organizationID: Schema.NullOr(Schema.String) },
})

export const KiloGatewayPlugin = define<Bus.Service | Scope.Scope>({
  id: "kilocode.gateway",
  effect: Effect.fn(function* (ctx) {
    const bus = yield* Bus.Service
    const server = KiloServer.fromEnv()
    let account: KiloAccount.Info | undefined
    let envActive = false

    const load = Effect.gen(function* () {
      // Environment tokens (`KILO_API_KEY`, `KILOCODE_TOKEN`, `KILO_AUTH_CONTENT`) take precedence over stored
      // credentials, matching v1 (`acd3d1ff9b`) and supporting headless/cloud consumers.
      const envInput = KiloAccount.envToken()
      if (envInput) {
        const selection = decodeSelection(yield* ctx.storage.get("organization:env"))
        envActive = true
        account = KiloAccount.resolve({
          ...envInput,
          server,
          organizationID: Option.isSome(selection) ? selection.value.organizationID : envInput.organizationID,
        })
        return
      }
      envActive = false
      const connection = yield* ctx.integration.connection.active(id)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      const selection = connection ? decodeSelection(yield* ctx.storage.get(organizationKey(connection))) : Option.none()
      account = credential ? toAccount(credential, Option.getOrUndefined(selection)) : undefined
    })

    yield* ctx.integration.transform((editor) => editor.method.update(device(server)))
    yield* load
    yield* ctx.provider.transform((editor) => {
      if (!editor.get(id)) return
      editor.update(id, (provider) => {
        const { apiKey: _, ...rest } = provider.settings ?? {}
        const settings = { ...rest, baseURL: KiloServer.gateway(account?.server ?? server) }
        provider.headers = {
          ...provider.headers,
          ...KiloHeaders.provider({ version: ctx.app.version, organizationID: account?.organizationID }),
        }
        if (account) {
          if (envActive) {
            provider.activation = "enabled"
            provider.settings = { ...settings, apiKey: account.token }
            return
          }
          provider.activation = "auto"
          provider.settings = settings
          return
        }
        // Signed out, the integration has no connection and the provider would stay hidden. The Gateway
        // serves its free models to the anonymous key, as in v1.
        provider.activation = "enabled"
        provider.settings = { ...settings, apiKey: KiloAccount.ANONYMOUS_KEY }
      })
    })
    const reload = load.pipe(Effect.andThen(ctx.provider.reload()))
    yield* ctx.rpc
      .register(KiloGatewayRpc.Definition, {
        profile: (_input, context) =>
          Effect.gen(function* () {
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
        // Same as v1 `setOrganization`, which stores the team in the auth record of the login. The choice
        // wins over the login default and is kept per connection.
        "organization.set": (input, context) =>
          Effect.gen(function* () {
            const envInput = KiloAccount.envToken()
            const connection = envInput ? undefined : yield* ctx.integration.connection.active(id)
            const key = envInput ? "organization:env" : connection ? organizationKey(connection) : undefined
            if (!key || !account)
              return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            yield* ctx.storage.set(key, { organizationID: input.organizationID })
            yield* reload
            yield* bus.publish(OrganizationEvent, { organizationID: input.organizationID }, { global: true })
            return {}
          }),
      })
      .pipe(Effect.orDie)
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          (event.type === "credential.switched" && event.data.integrationID === id) ||
          event.type === OrganizationEvent.type,
      ),
      Stream.runForEach(() => reload),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})

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
