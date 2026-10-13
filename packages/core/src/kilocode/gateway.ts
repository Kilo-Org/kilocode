import { KiloAccount, KiloDevice, KiloHeaders, KiloProfile, KiloServer } from "@kilocode/gateway-core"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Clock, Effect, Option, Schema, Stream } from "effect"
import { KiloGatewayRpc } from "./gateway-rpc.js"

// v2 adapter for the Kilo Gateway. Kilo logic lives in @kilocode/gateway-core; this file only maps it
// onto the public plugin API. The `kilo` integration and provider come from the models.dev seed.
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
// Published on the global bus, so plugin instances of other locations also reload.
const organizationEvent = `rpc.${KiloGatewayRpc.Definition.id}.organization`

export const KiloGatewayPlugin = define({
  id: "kilocode.gateway",
  effect: Effect.fn(function* (ctx) {
    const server = KiloServer.fromEnv()
    let account: KiloAccount.Info | undefined
    // Set after the RPC registration below, which owns the event.
    let emit: (organizationID: string | null) => Effect.Effect<void> = () => Effect.void

    const load = Effect.gen(function* () {
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
        provider.headers = {
          ...provider.headers,
          ...KiloHeaders.provider({ version: ctx.app.version, organizationID: account?.organizationID }),
        }
        const baseURL = KiloServer.gateway(account?.server ?? server)
        if (account) {
          provider.settings = { ...provider.settings, baseURL }
          return
        }
        // Signed out, the integration has no connection and the provider would stay hidden. The Gateway
        // serves its free models to the anonymous key, as in v1.
        provider.activation = "enabled"
        provider.settings = { ...provider.settings, baseURL, apiKey: KiloAccount.ANONYMOUS_KEY }
      })
    })
    const reload = load.pipe(Effect.andThen(ctx.provider.reload()))
    const rpc = yield* ctx.rpc
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
            const connection = yield* ctx.integration.connection.active(id)
            if (!connection || !account)
              return yield* Effect.fail(context.error("unauthorized", "Not signed in to Kilo Gateway"))
            yield* ctx.storage.set(organizationKey(connection), { organizationID: input.organizationID })
            yield* reload
            yield* emit(input.organizationID)
            return {}
          }),
      })
      .pipe(Effect.orDie)
    emit = (organizationID) => rpc.events.emit("organization", { organizationID }).pipe(Effect.ignore)
    yield* ctx.event.subscribe().pipe(
      Stream.filter(
        (event) =>
          (event.type === "credential.switched" && event.data.integrationID === id) ||
          event.type === organizationEvent,
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
              expires: (yield* Clock.currentTimeMillis) + KiloDevice.TOKEN_LIFETIME,
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
