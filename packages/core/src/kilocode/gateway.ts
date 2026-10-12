import { KiloAccount, KiloDevice, KiloHeaders, KiloServer } from "@kilocode/gateway-core"
import type { IntegrationOAuthMethodRegistration } from "@opencode/plugin/effect/integration"
import { define } from "@opencode/plugin/effect/plugin"
import { Credential } from "@opencode/schema/credential"
import { IntegrationMethodID } from "@opencode/schema/integration-id"
import { Clock, Effect, Option, Schema, Stream } from "effect"

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

export const KiloGatewayPlugin = define({
  id: "kilocode.gateway",
  effect: Effect.fn(function* (ctx) {
    const server = KiloServer.fromEnv()
    let account: KiloAccount.Info | undefined

    const load = Effect.gen(function* () {
      const connection = yield* ctx.integration.connection.active(id)
      const credential = connection
        ? yield* ctx.integration.connection.resolve(connection).pipe(Effect.orElseSucceed(() => undefined))
        : undefined
      account = credential ? toAccount(credential) : undefined
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
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "credential.switched" && event.data.integrationID === id),
      Stream.runForEach(() => load.pipe(Effect.andThen(ctx.provider.reload()))),
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

function toAccount(credential: Credential.Value) {
  if (credential.type === "external") return undefined
  const metadata = Option.getOrUndefined(decodeMetadata(credential.metadata ?? {}))
  return KiloAccount.resolve({
    token: credential.type === "oauth" ? credential.access : credential.key,
    server: metadata?.server,
    organizationID: metadata?.organizationID,
  })
}
