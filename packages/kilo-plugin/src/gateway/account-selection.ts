export * as GatewayAccountSelection from "./account-selection.js"

import { KiloAccount, KiloCredential, KiloServer } from "@kilocode/gateway-core"
import type { ConnectionInfo } from "@opencode/client"
import type { Entry } from "@opencode/schema/config"
import type { Credential } from "@opencode/schema/credential"
import { Option, Schema } from "effect"
import { GatewayCatalog } from "./catalog.js"

type Env = Readonly<Record<string, string | undefined>>

const decodeMetadata = Schema.decodeUnknownOption(
  Schema.Struct({
    server: Schema.optional(Schema.String),
    organizationID: Schema.optional(Schema.NullOr(Schema.String)),
    accountID: Schema.optional(Schema.String),
  }),
)
const decodeSettings = Schema.decodeUnknownOption(
  Schema.Struct({
    apiKey: Schema.optional(Schema.String),
    kilocodeToken: Schema.optional(Schema.String),
    baseURL: Schema.optional(Schema.String),
    kilocodeOrganizationId: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)
// An absent selection is distinct from a stored `null` organization (Personal).
const Selection = Schema.Struct({ organizationID: Schema.NullOr(Schema.String) })
type Selection = typeof Selection.Type
export const decodeSelection = Schema.decodeUnknownOption(Selection)

export function overrides(entries: readonly Entry[], env: Env) {
  const settings = Option.getOrUndefined(
    decodeSettings(
      Object.assign(
        {},
        ...entries.flatMap((entry) => (entry.type === "document" ? [entry.info.providers?.kilo?.settings ?? {}] : [])),
      ),
    ),
  )
  return {
    settings,
    direct: KiloAccount.envToken(env),
    gateway: settings?.baseURL ? KiloServer.normalize(settings.baseURL) : KiloServer.aiGatewayFromEnv(env),
    content: KiloAccount.authContent(env),
  }
}

type Overrides = ReturnType<typeof overrides>

export function selectCredential(
  input: Overrides,
  connection: ConnectionInfo | undefined,
  credential: Credential.Value | undefined,
) {
  const saved = input.content !== undefined ? (input.content ?? undefined) : credential && credentialInput(credential)
  const token = input.direct?.token ?? saved?.token ?? input.settings?.kilocodeToken ?? input.settings?.apiKey
  return {
    token,
    saved,
    connection: !input.direct && input.content === undefined && saved ? connection : undefined,
    envActive: Boolean(input.direct || input.content !== undefined || (!saved && token !== undefined)),
    useLegacySelection: Boolean(input.direct || input.content),
  }
}

type SelectedCredential = ReturnType<typeof selectCredential>

export function selectRoute(input: Overrides, credential: SelectedCredential, env: Env) {
  const loginServer =
    !input.direct && credential.saved?.server ? KiloServer.normalize(credential.saved.server) : undefined
  // A login on the configured API app still uses the configured inference Gateway.
  const base =
    input.settings?.baseURL || (loginServer === KiloServer.fromEnv(env) ? undefined : loginServer) || input.gateway
  const selectionKey =
    credential.token === undefined
      ? undefined
      : credential.connection
        ? organizationKey(credential.connection)
        : `organization:${GatewayCatalog.snapshotKey(KiloServer.fromToken(credential.token) ?? base, credential.token)}`
  return { base, selectionKey }
}

export function selectOrganization(
  input: Overrides,
  credential: SelectedCredential,
  base: string,
  selection: Selection | undefined,
  env: Env,
) {
  const saved = credential.saved?.organizationID
  const configured = input.settings?.kilocodeOrganizationId
  const organizationID = selection ? selection.organizationID : saved === null ? null : saved || configured
  const account =
    credential.token === undefined
      ? undefined
      : KiloAccount.resolve(
          { token: credential.token, server: base, organizationID: organizationID === "" ? undefined : organizationID },
          env,
        )
  return {
    account,
    organizationID,
    personalSelected: selection?.organizationID === null || (!input.direct && saved === null) || configured === null,
  }
}

export function activeOrganization(scope: ReturnType<typeof selectOrganization>, base: string, env: Env) {
  if (scope.account) return scope.account.organizationID
  return env.KILO_ORG_ID || scope.organizationID || KiloServer.organizationFromUrl(base) || null
}

export function organizationKey(connection: ConnectionInfo) {
  return `organization:${connection.type === "credential" ? connection.id : `env:${connection.name}`}`
}

function credentialInput(credential: Credential.Value): KiloAccount.Input | undefined {
  const token = KiloCredential.token(credential)
  if (token === undefined) return undefined
  const metadata = Option.getOrUndefined(decodeMetadata(credential.metadata ?? {}))
  return {
    token,
    server: metadata?.server,
    // Only a missing team falls back to the imported account ID.
    organizationID: metadata?.organizationID === undefined ? metadata?.accountID : metadata.organizationID,
  }
}
