import { ConfigMigrateV1 } from "@opencode-ai/core/v1/config/migrate"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { serverUrl } from "@kilocode/gateway"
import { NonNegativeInt } from "@opencode-ai/schema/schema"
import { Schema } from "effect"
import { parse, type ParseError } from "jsonc-parser"
import { constants } from "node:fs"
import { randomUUID } from "node:crypto"
import { mkdir, open, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { CredentialWriter } from "./credential-import"
import { preflight, type Layout } from "./paths"

export interface ImportSourceFacts {
  readonly path: string
  readonly bytes: number
  readonly sha256: string
}

export type CredentialDecision =
  | {
      readonly source: string
      readonly kind: "api-key"
      readonly supported: true
      readonly integrationID: string
      readonly key: string
      readonly metadata?: Readonly<Record<string, string>>
      readonly label: string
    }
  | {
      readonly source: string
      readonly kind: "oauth"
      readonly supported: true
      readonly integrationID: "kilo"
      readonly methodID: "device"
      readonly refresh: string
      readonly access: string
      readonly expires: number
      readonly server: string
      readonly organizationID: string | null
      readonly label: string
    }
  | {
      readonly source: string
      readonly kind: "oauth"
      readonly supported: true
      readonly integrationID: "openai" | "github-copilot" | "xai"
      readonly methodID: "chatgpt-browser" | "device"
      readonly refresh: string
      readonly access: string
      readonly expires: number
      readonly metadata?: Readonly<Record<string, string>>
      readonly label: string
    }
  | {
      readonly source: string
      readonly kind: "wellknown"
      readonly supported: true
      readonly integrationID: string
      readonly environmentKey: string
      readonly token: string
      readonly label: string
    }
  | {
      readonly source: string
      readonly kind: "api-key" | "oauth" | "wellknown" | "unknown"
      readonly supported: false
      readonly reason: string
      readonly metadataKeys?: ReadonlyArray<string>
    }

export type ConfigKeyDecision =
  | { readonly key: string; readonly supported: true }
  | { readonly key: string; readonly supported: false; readonly reason: string; readonly paths?: ReadonlyArray<string> }

type MigratedConfig = ReturnType<typeof ConfigMigrateV1.migrate> & {
  readonly privacy_mode?: boolean
  readonly hide_prompt_training_models?: boolean
}

export interface ImportPlan {
  readonly sources: { readonly auth?: ImportSourceFacts; readonly config?: ImportSourceFacts }
  readonly credentials: ReadonlyArray<CredentialDecision>
  readonly configKeys: ReadonlyArray<ConfigKeyDecision>
  readonly config: Readonly<MigratedConfig>
}

export interface ImportIntegrationInfo {
  readonly id: string
  readonly methods: ReadonlyArray<{ readonly id?: string; readonly type: string; readonly form?: unknown }>
  readonly connections: ReadonlyArray<{ readonly type: string }>
}

export interface ImportLocation {
  readonly directory: string
  readonly workspace?: string
}

export interface ImportClient {
  readonly integration: {
    readonly list: (input?: {
      readonly location?: ImportLocation
    }) => Promise<{ readonly data: ReadonlyArray<ImportIntegrationInfo> }>
    readonly wellknown: {
      readonly add: (input: { readonly url: string; readonly location?: ImportLocation }) => Promise<unknown>
    }
    readonly connect: {
      readonly key: (input: {
        readonly integrationID: string
        readonly location?: ImportLocation
        readonly key: string
        readonly label?: string
      }) => Promise<unknown>
    }
  }
}

export interface AppliedCredential {
  readonly integrationID: string
  readonly label: string
}

export interface AppliedWellKnownSource {
  readonly origin: string
}

type WellKnownPreparation =
  | {
      readonly integrations: ReadonlyArray<ImportIntegrationInfo>
      readonly sources: ReadonlyArray<AppliedWellKnownSource>
    }
  | { readonly reason: string; readonly sources: ReadonlyArray<AppliedWellKnownSource> }

export type ImportResult =
  | {
      readonly status: "applied"
      readonly plan: ImportPlan
      readonly credentials: ReadonlyArray<AppliedCredential>
      readonly configKeys: ReadonlyArray<string>
      readonly wellKnownSources: ReadonlyArray<AppliedWellKnownSource>
    }
  | { readonly status: "refused"; readonly plan: ImportPlan; readonly reason: string }
  | {
      readonly status: "failed"
      readonly plan: ImportPlan
      readonly reason: string
      readonly appliedCredentials: ReadonlyArray<AppliedCredential>
      readonly configWritten: boolean
      readonly wellKnownSources: ReadonlyArray<AppliedWellKnownSource>
    }

export interface ImportReportCredential {
  readonly source: string
  readonly kind: CredentialDecision["kind"]
  readonly supported: boolean
  readonly integrationID?: string
  readonly label?: string
  readonly reason?: string
  readonly metadataKeys?: ReadonlyArray<string>
}

export interface ImportReport {
  readonly status?: ImportResult["status"]
  readonly reason?: string
  readonly sources: ImportPlan["sources"]
  readonly credentials: ReadonlyArray<ImportReportCredential>
  readonly configKeys: ReadonlyArray<ConfigKeyDecision>
  readonly writtenConfigKeys?: ReadonlyArray<string>
  readonly appliedCredentials?: ReadonlyArray<AppliedCredential>
  readonly wellKnownSources?: ReadonlyArray<AppliedWellKnownSource>
  readonly configWritten?: boolean
}

export interface ImportInput {
  readonly layout: Layout
  readonly client?: ImportClient
  readonly auth?: string
  readonly config?: string
  readonly gatewayServer?: string
  readonly writeCredential?: CredentialWriter
  readonly location?: ImportLocation
  readonly allowOverwrite?: boolean
  readonly allowUnmapped?: boolean
}

const decodeOptions = { errors: "all", onExcessProperty: "ignore", propertyOrder: "original" } as const

const OAuthV1 = Schema.Struct({
  type: Schema.Literal("oauth"),
  refresh: Schema.String,
  access: Schema.String,
  expires: NonNegativeInt,
  accountId: Schema.optional(Schema.String),
  enterpriseUrl: Schema.optional(Schema.String),
})

const ApiV1 = Schema.Struct({
  type: Schema.Literal("api"),
  key: Schema.String,
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.String)),
})

const WellKnownV1 = Schema.Struct({
  type: Schema.Literal("wellknown"),
  key: Schema.String,
  token: Schema.String,
})

const AuthValueV1 = Schema.Union([OAuthV1, ApiV1, WellKnownV1]).pipe(Schema.toTaggedUnion("type"))

type AuthValue = typeof AuthValueV1.Type

const decodeAuthValue = Schema.decodeUnknownSync(AuthValueV1, decodeOptions)
// The legacy migrator declares mutable arrays; its public schema decoder emits
// readonly arrays of the same validated shape. Migration only reads this value.
const decodeConfigV1 = Schema.decodeUnknownSync(ConfigV1.Info, decodeOptions) as (value: unknown) => ConfigV1.Info

// v1 runtime marker (Kilo main's OAUTH_DUMMY_KEY): plugins pass it as a placeholder
// apiKey while the real token travels via OAuth, so it is not a credential and
// must not be imported as one.
const oauthDummyKey = "kilo-oauth-dummy-key"

// Kilo main declares these keys as NullOr(string), where null means "explicitly
// unset"; the retained upstream v1 schema only accepts strings, so nulls are
// dropped before decoding instead of failing the whole file.
const nullableConfigKeys = ["model", "small_model", "default_agent"] as const

// Kilo-only v1 booleans carried verbatim into the isolated profile config. The
// retained upstream v1 schema does not declare them, and the migration engine
// drops them, so they are validated and patched at the raw level instead.
const kiloOnlyBooleans = ["privacy_mode", "hide_prompt_training_models"] as const

// Matches the upstream v2 config parser options (jsonc parse with trailing commas).
const IMPORT_SOURCE_MAX_BYTES = 10 * 1024 * 1024

export async function planV1Import(input: {
  auth?: string
  config?: string
  gatewayServer?: string
}): Promise<ImportPlan> {
  if (!input.auth && !input.config) throw new Error("Specify a v1 auth.json file, a v1 config file, or both")
  const credentials: CredentialDecision[] = []
  const configKeys: ConfigKeyDecision[] = []
  const sources: { auth?: ImportSourceFacts; config?: ImportSourceFacts } = {}
  let config: MigratedConfig | undefined
  if (input.auth) {
    const source = await readSource(input.auth)
    sources.auth = source.facts
    credentials.push(
      ...planCredentials(
        source.facts,
        parseSource(source.facts.path, source.text, "v1 auth file"),
        input.gatewayServer,
      ),
    )
  }
  if (input.config) {
    const source = await readSource(input.config)
    sources.config = source.facts
    const planned = planConfig(source.facts.path, parseSource(source.facts.path, source.text, "v1 config file"))
    configKeys.push(...planned.keys)
    config = planned.patch
  }
  return {
    sources,
    credentials,
    configKeys,
    config: config ?? ({} as MigratedConfig),
  }
}

export async function applyV1Import(input: {
  layout: Layout
  client?: ImportClient
  writeCredential?: CredentialWriter
  location?: ImportLocation
  plan: ImportPlan
  allowOverwrite?: boolean
  allowUnmapped?: boolean
}): Promise<ImportResult> {
  const { layout, plan } = input
  preflight(layout)
  const supported = plan.credentials.filter(
    (entry): entry is Extract<CredentialDecision, { supported: true }> => entry.supported,
  )
  const blocked = plan.credentials.filter((entry) => !entry.supported)
  if (blocked.length > 0) return refused(plan, credentialBlockReason(blocked))
  const unmapped = plan.configKeys.filter((key) => !key.supported)
  if (unmapped.length > 0 && !input.allowUnmapped) return refused(plan, unmappedBlockReason(unmapped))
  if (supported.length > 0 && !input.client)
    return refused(plan, "Credential import requires a connected profile client")
  if (supported.some(requiresCredentialWriter) && !input.writeCredential)
    return refused(plan, "Credential import requires the host credential writer")

  let integrations: ReadonlyArray<ImportIntegrationInfo> = []
  const client = supported.length > 0 ? input.client : undefined
  if (client) {
    integrations = (
      await client.integration.list(input.location === undefined ? undefined : { location: input.location })
    ).data
    for (const entry of supported) {
      if (entry.kind === "wellknown") continue
      const integration = integrations.find((item) => item.id === entry.integrationID)
      if (!integration)
        return refused(plan, `Integration "${entry.integrationID}" is not registered in this v2 profile`)
      if (entry.kind === "api-key" && !integration.methods.some((method) => method.type === "key"))
        return refused(plan, `Integration "${entry.integrationID}" has no key authentication method`)
      if (
        entry.kind === "oauth" &&
        !integration.methods.some((method) => method.type === "oauth" && method.id === entry.methodID)
      )
        return refused(plan, `Integration "${entry.integrationID}" has no OAuth method "${entry.methodID}"`)
    }
  }

  const existing = Object.keys(plan.config).length > 0 ? await readExistingConfig(layout.config) : undefined
  const merged: Record<string, unknown> = { ...existing }
  const changed: string[] = []
  for (const [key, value] of Object.entries(plan.config)) {
    if (existing && key in existing) {
      if (JSON.stringify(existing[key]) === JSON.stringify(value)) continue
      if (!input.allowOverwrite)
        return refused(plan, `Config key "${key}" already set in ${layout.config} with a different value`)
    }
    merged[key] = value
    changed.push(key)
  }

  if (client) {
    const conflicts = supported
      .filter((entry) => entry.kind !== "wellknown")
      .filter((entry) =>
        integrations
          .find((item) => item.id === entry.integrationID)
          ?.connections.some((connection) => connection.type === "credential"),
      )
      .map((entry) => `Integration "${entry.integrationID}" already has a stored credential connection`)
    if (conflicts.length > 0 && !input.allowOverwrite) return refused(plan, conflicts.join("; "))
  }

  const discovered = client
    ? await prepareWellKnownSources(client, supported, input.location)
    : { sources: [] as AppliedWellKnownSource[], integrations }
  if ("reason" in discovered && discovered.sources.length === 0) return refused(plan, discovered.reason)
  if ("reason" in discovered)
    return {
      status: "failed",
      plan,
      reason: discovered.reason,
      appliedCredentials: [],
      configWritten: false,
      wellKnownSources: discovered.sources,
    }
  integrations = discovered.integrations
  const wellKnownSources = discovered.sources
  if (client) {
    const conflicts = supported
      .filter((entry) => entry.kind === "wellknown")
      .flatMap((entry) => {
        const integration = integrations.find((item) => item.id === entry.integrationID)
        if (!integration) return [`Well-known integration "${entry.integrationID}" was not registered after discovery`]
        if (!integration.methods.some((method) => method.type === "command" && method.id === "login"))
          return [`Well-known integration "${entry.integrationID}" has no login command after discovery`]
        if (!integration.connections.some((connection) => connection.type === "credential") || input.allowOverwrite)
          return []
        return [`Integration "${entry.integrationID}" already has a stored credential connection`]
      })
    if (conflicts.length > 0)
      return {
        status: "failed",
        plan,
        reason: conflicts.join("; "),
        appliedCredentials: [],
        configWritten: false,
        wellKnownSources,
      }
  }

  if (changed.length > 0) {
    try {
      await writeConfig(layout, merged)
    } catch {
      return {
        status: "failed",
        plan,
        reason: "Configuration could not be written into the isolated profile",
        appliedCredentials: [],
        configWritten: false,
        wellKnownSources,
      }
    }
  }

  const applied: AppliedCredential[] = []
  if (client) {
    for (const entry of supported) {
      const failure = await writeImportedCredential(input.writeCredential, client, entry, input.location)
      if (failure !== undefined)
        return {
          status: "failed",
          plan,
          reason: `Credential for "${entry.integrationID}" could not be imported: the profile server rejected or could not process the request`,
          appliedCredentials: applied,
          configWritten: changed.length > 0,
          wellKnownSources,
        }
      applied.push({ integrationID: entry.integrationID, label: entry.label })
    }
  }
  return { status: "applied", plan, credentials: applied, configKeys: changed, wellKnownSources }
}

export async function importV1Config(input: ImportInput): Promise<ImportResult> {
  const plan = await planV1Import({ auth: input.auth, config: input.config, gatewayServer: input.gatewayServer })
  return applyV1Import({ ...input, plan })
}

export function reportV1Import(input: ImportPlan | ImportResult): ImportReport {
  const plan = "plan" in input ? input.plan : input
  const credentials = plan.credentials.map(
    (entry): ImportReportCredential =>
      entry.supported
        ? {
            source: entry.source,
            kind: entry.kind,
            supported: true,
            integrationID: entry.integrationID,
            label: entry.label,
          }
        : {
            source: entry.source,
            kind: entry.kind,
            supported: false,
            reason: entry.reason,
            ...(entry.metadataKeys ? { metadataKeys: entry.metadataKeys } : {}),
          },
  )
  if (!("status" in input)) return { sources: plan.sources, credentials, configKeys: plan.configKeys }
  return {
    status: input.status,
    reason: input.status === "applied" ? undefined : input.reason,
    sources: plan.sources,
    credentials,
    configKeys: plan.configKeys,
    ...(input.status === "applied"
      ? {
          writtenConfigKeys: input.configKeys,
          appliedCredentials: input.credentials,
          ...(input.wellKnownSources.length > 0 ? { wellKnownSources: input.wellKnownSources } : {}),
        }
      : {}),
    ...(input.status === "failed"
      ? {
          appliedCredentials: input.appliedCredentials,
          configWritten: input.configWritten,
          ...(input.wellKnownSources.length > 0 ? { wellKnownSources: input.wellKnownSources } : {}),
        }
      : {}),
  }
}

function requiresCredentialWriter(entry: Extract<CredentialDecision, { readonly supported: true }>) {
  return entry.kind === "oauth" || entry.kind === "wellknown" || entry.metadata !== undefined
}

async function prepareWellKnownSources(
  client: ImportClient,
  entries: ReadonlyArray<Extract<CredentialDecision, { readonly supported: true }>>,
  location: ImportLocation | undefined,
): Promise<WellKnownPreparation> {
  const wellknown = entries.filter((entry) => entry.kind === "wellknown")
  for (const entry of wellknown) {
    if (!(await matchesWellKnownEnvironment(entry.integrationID, entry.environmentKey)))
      return {
        reason: `Well-known source "${entry.integrationID}" does not expose the v1 authentication environment key`,
        sources: [] as AppliedWellKnownSource[],
      }
  }
  const sources: AppliedWellKnownSource[] = []
  for (const entry of wellknown) {
    try {
      await client.integration.wellknown.add({
        url: entry.integrationID,
        ...(location === undefined ? {} : { location }),
      })
    } catch {
      return {
        reason: `Well-known source "${entry.integrationID}" could not be discovered by the profile server`,
        sources,
      }
    }
    sources.push({ origin: entry.integrationID })
  }
  try {
    return {
      sources,
      integrations: (await client.integration.list(location === undefined ? undefined : { location })).data,
    }
  } catch {
    return {
      reason: "Well-known sources were discovered but the profile inventory could not be refreshed",
      sources,
    }
  }
}

async function matchesWellKnownEnvironment(origin: string, environmentKey: string) {
  try {
    const response = await fetch(`${origin}/.well-known/opencode`)
    if (!response.ok) return false
    const manifest = await response.json()
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) return false
    const auth = (manifest as Record<string, unknown>).auth
    if (typeof auth !== "object" || auth === null || Array.isArray(auth)) return false
    return (auth as Record<string, unknown>).env === environmentKey
  } catch {
    return false
  }
}

async function writeImportedCredential(
  writer: CredentialWriter | undefined,
  client: ImportClient,
  entry: Extract<CredentialDecision, { readonly supported: true }>,
  location: ImportLocation | undefined,
) {
  try {
    if (entry.kind === "wellknown") {
      await writer!({
        kind: "api-key",
        integrationID: entry.integrationID,
        key: entry.token,
        label: entry.label,
      })
      return
    }
    if (entry.kind === "oauth") {
      if (entry.integrationID === "kilo")
        await writer!({
          kind: "kilo-oauth",
          integrationID: entry.integrationID,
          methodID: entry.methodID,
          refresh: entry.refresh,
          access: entry.access,
          expires: entry.expires,
          server: entry.server,
          organizationID: entry.organizationID,
          label: entry.label,
        })
      if (entry.integrationID !== "kilo")
        await writer!({
          kind: "oauth",
          integrationID: entry.integrationID,
          methodID: entry.methodID,
          refresh: entry.refresh,
          access: entry.access,
          expires: entry.expires,
          ...(entry.metadata === undefined ? {} : { metadata: entry.metadata }),
          label: entry.label,
        })
      return
    }
    if (entry.metadata !== undefined) {
      await writer!({
        kind: "api-key",
        integrationID: entry.integrationID,
        key: entry.key,
        metadata: entry.metadata,
        label: entry.label,
      })
      return
    }
    await client.integration.connect.key({
      integrationID: entry.integrationID,
      key: entry.key,
      label: entry.label,
      ...(location === undefined ? {} : { location }),
    })
  } catch {
    return "rejected" as const
  }
}

function planCredentials(
  source: ImportSourceFacts,
  parsed: Record<string, unknown>,
  gatewayServer: string | undefined,
): CredentialDecision[] {
  return Object.entries(parsed).map(([providerKey, value]) => {
    const integrationID = providerKey.replace(/\/+$/, "")
    if (!integrationID) return unsupported(providerKey, "unknown", "Provider key normalizes to an empty integration ID")
    const decoded = decodeAuth(value)
    if (typeof decoded === "string") return unsupported(providerKey, "unknown", decoded)
    if (decoded.type === "oauth") {
      const extras = extraKeys(value, ["type", "refresh", "access", "expires"])
      if (integrationID === "kilo")
        return planKiloOAuth(
          providerKey,
          decoded,
          extras.filter((key) => key !== "accountId"),
          gatewayServer,
        )
      if (integrationID === "openai")
        return planOpenAIOAuth(
          providerKey,
          decoded,
          extras.filter((key) => key !== "accountId"),
        )
      if (integrationID === "github-copilot")
        return planGithubCopilotOAuth(
          providerKey,
          decoded,
          extras.filter((key) => key !== "enterpriseUrl"),
        )
      if (integrationID === "xai") return planXaiOAuth(providerKey, decoded, extras)
      return {
        source: providerKey,
        kind: "oauth" as const,
        supported: false as const,
        reason: oauthReason(extras),
        ...(extras.length > 0 ? { metadataKeys: extras } : {}),
      }
    }
    if (decoded.type === "wellknown") {
      if (!decoded.key.trim())
        return unsupported(providerKey, "wellknown", "Well-known authentication environment key is empty")
      if (!decoded.token.trim())
        return unsupported(providerKey, "wellknown", "Well-known authentication token is empty")
      return {
        source: providerKey,
        kind: "wellknown",
        supported: true,
        integrationID,
        environmentKey: decoded.key,
        token: decoded.token,
        label: "Imported from v1",
      }
    }
    if (!decoded.key.trim()) return unsupported(providerKey, "api-key", "Credential key is empty")
    if (decoded.key === oauthDummyKey)
      return unsupported(providerKey, "api-key", "Value is the v1 OAuth runtime sentinel, not a real credential")
    return {
      source: providerKey,
      kind: "api-key" as const,
      supported: true as const,
      integrationID,
      key: decoded.key,
      ...(decoded.metadata && Object.keys(decoded.metadata).length > 0 ? { metadata: decoded.metadata } : {}),
      label: "Imported from v1",
    }
  })
}

function planOpenAIOAuth(
  source: string,
  credential: Extract<AuthValue, { readonly type: "oauth" }>,
  extras: ReadonlyArray<string>,
): CredentialDecision {
  if (extras.length > 0)
    return unsupported(source, "oauth", `OpenAI OAuth entry has unsupported fields (${extras.join(", ")})`)
  return {
    source,
    kind: "oauth",
    supported: true,
    integrationID: "openai",
    methodID: "chatgpt-browser",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
    ...(credential.accountId === undefined ? {} : { metadata: { accountID: credential.accountId } }),
    label: "Imported from v1",
  }
}

function planGithubCopilotOAuth(
  source: string,
  credential: Extract<AuthValue, { readonly type: "oauth" }>,
  extras: ReadonlyArray<string>,
): CredentialDecision {
  if (extras.length > 0)
    return unsupported(source, "oauth", `GitHub Copilot OAuth entry has unsupported fields (${extras.join(", ")})`)
  return {
    source,
    kind: "oauth",
    supported: true,
    integrationID: "github-copilot",
    methodID: "device",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
    ...(credential.enterpriseUrl === undefined ? {} : { metadata: { enterpriseUrl: credential.enterpriseUrl } }),
    label: "Imported from v1",
  }
}

function planXaiOAuth(
  source: string,
  credential: Extract<AuthValue, { readonly type: "oauth" }>,
  extras: ReadonlyArray<string>,
): CredentialDecision {
  if (extras.length > 0)
    return unsupported(source, "oauth", `xAI OAuth entry has unsupported fields (${extras.join(", ")})`)
  return {
    source,
    kind: "oauth",
    supported: true,
    integrationID: "xai",
    methodID: "device",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
    label: "Imported from v1",
  }
}

function planKiloOAuth(
  source: string,
  credential: Extract<AuthValue, { readonly type: "oauth" }>,
  extras: ReadonlyArray<string>,
  gatewayServer: string | undefined,
): CredentialDecision {
  if (extras.length > 0)
    return unsupported(source, "oauth", `Kilo OAuth entry has unsupported fields (${extras.join(", ")})`)
  if (credential.accountId !== undefined && !isUUID(credential.accountId))
    return unsupported(source, "oauth", "Kilo OAuth accountId must be a UUID")
  if (gatewayServer === undefined)
    return unsupported(source, "oauth", "Kilo OAuth import requires an explicit gateway server")
  let server: string
  try {
    server = serverUrl(gatewayServer)
  } catch {
    return unsupported(source, "oauth", "Kilo OAuth gateway server is invalid")
  }
  return {
    source,
    kind: "oauth",
    supported: true,
    integrationID: "kilo",
    methodID: "device",
    refresh: credential.refresh,
    access: credential.access,
    expires: credential.expires,
    server,
    organizationID: credential.accountId ?? null,
    label: "Imported from v1",
  }
}

function isUUID(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
}

function extraKeys(raw: unknown, core: ReadonlyArray<string>): string[] {
  if (typeof raw !== "object" || raw === null) return []
  return Object.keys(raw).filter((key) => !core.includes(key))
}

function oauthReason(extras: ReadonlyArray<string>): string {
  const base =
    "existing OAuth tokens cannot be imported through the v2 public client API; re-authorize interactively in v2"
  return extras.length > 0
    ? `${base}; the entry carries additional fields (${extras.join(", ")}) that are reported here but not imported`
    : base
}

function decodeAuth(value: unknown): string | AuthValue {
  try {
    return decodeAuthValue(value)
  } catch {
    // Schema errors can echo the decoded input, which may carry secret values.
    return "Entry does not match the v1 credential schema"
  }
}

function unsupported(
  source: string,
  kind: "api-key" | "oauth" | "wellknown" | "unknown",
  reason: string,
): CredentialDecision {
  return { source, kind, supported: false, reason }
}

function planConfig(
  filepath: string,
  parsed: Record<string, unknown>,
): { keys: ConfigKeyDecision[]; patch: MigratedConfig } {
  const normalized = normalizeNulls(parsed)
  // Kilo v1 booleans consumed by isolated v2 stores use the same keys. They are
  // intentionally not added to the upstream schema or migration engine.
  for (const key of kiloOnlyBooleans)
    if (parsed[key] !== undefined && typeof parsed[key] !== "boolean")
      throw new Error(`${filepath} does not match the v1 configuration schema`)
  let info: ConfigV1.Info
  let patch: MigratedConfig
  try {
    info = decodeConfigV1(normalized)
    patch = dropUndefined(ConfigMigrateV1.migrate(info))
  } catch {
    // Schema and migration errors can echo the decoded input, which may carry secret values.
    throw new Error(`${filepath} does not match the v1 configuration schema`)
  }
  const recognized = Object.keys(ConfigV1.Info.fields)
  const baseline = JSON.stringify(patch)
  const keys = Object.keys(parsed).map((key): ConfigKeyDecision => {
    if ((kiloOnlyBooleans as readonly string[]).includes(key)) return { key, supported: true }
    if (nulledKeys(parsed).includes(key)) return { key, supported: true }
    const leaves = leafPaths(parsed[key], [key])
    if (leaves.length === 0) {
      if (reduces(patch, info, key)) return { key, supported: true }
      if (recognized.includes(key))
        return { key, supported: false, reason: "Recognized v1 key that the upstream migration does not carry into v2" }
      return { key, supported: false, reason: "No proven v2 mapping for this v1 key; not imported" }
    }
    const dropped = leaves.filter((leaf) => !carried(parsed, leaf, baseline))
    if (dropped.length === 0) return { key, supported: true }
    const shown = dropped.slice(0, 5).map(formatPath)
    return {
      key,
      supported: false,
      reason: `${dropped.length === leaves.length ? "v1 key" : "v1 sub-paths"} not carried into the migrated v2 config (dropped or shadowed): ${shown.join(", ")}`,
      paths: dropped.slice(0, 20).map(formatPath),
    }
  })
  return {
    keys,
    patch: {
      ...patch,
      ...(typeof parsed.privacy_mode === "boolean" ? { privacy_mode: parsed.privacy_mode } : {}),
      ...(typeof parsed.hide_prompt_training_models === "boolean"
        ? { hide_prompt_training_models: parsed.hide_prompt_training_models }
        : {}),
    },
  }
}

function nulledKeys(parsed: Record<string, unknown>): ReadonlyArray<string> {
  return nullableConfigKeys.filter((key) => parsed[key] === null)
}

function normalizeNulls(parsed: Record<string, unknown>): Record<string, unknown> {
  const normalized: Record<string, unknown> = { ...parsed }
  for (const key of nulledKeys(parsed)) delete normalized[key]
  return normalized
}

function leafPaths(value: unknown, prefix: ReadonlyArray<string | number>): Array<Array<string | number>> {
  if (Array.isArray(value)) return value.flatMap((item, index) => leafPaths(item, [...prefix, index]))
  if (value !== null && typeof value === "object")
    return Object.entries(value).flatMap(([key, item]) => leafPaths(item, [...prefix, key]))
  return [[...prefix]]
}

function withoutLeaf(
  root: Record<string, unknown>,
  leaf: ReadonlyArray<string | number>,
): Record<string, unknown> | undefined {
  const clone = structuredClone(root)
  let node: unknown = clone
  for (const segment of leaf.slice(0, -1)) {
    if (node === null || typeof node !== "object") return undefined
    node = Reflect.get(node, segment)
    if (node === undefined) return undefined
  }
  if (node === null || typeof node !== "object") return undefined
  const last = leaf[leaf.length - 1]
  if (Array.isArray(node)) {
    if (typeof last !== "number" || last >= node.length) return undefined
    node.splice(last, 1)
    return clone
  }
  if (typeof last !== "string" || !(last in node)) return undefined
  Reflect.deleteProperty(node, last)
  return clone
}

function carried(parsed: Record<string, unknown>, leaf: ReadonlyArray<string | number>, baseline: string): boolean {
  const reduced = withoutLeaf(parsed, leaf)
  if (!reduced) return true
  try {
    const decoded = decodeConfigV1(normalizeNulls(reduced))
    return JSON.stringify(dropUndefined(ConfigMigrateV1.migrate(decoded))) !== baseline
  } catch {
    // If removing the leaf breaks the v1 shape or the v2 encoding, the leaf is load-bearing.
    return true
  }
}

function reduces(patch: MigratedConfig, info: ConfigV1.Info, key: string): boolean {
  if (!(key in info)) return false
  const reduced = { ...info } as Record<string, unknown>
  delete reduced[key]
  return JSON.stringify(dropUndefined(ConfigMigrateV1.migrate(reduced as ConfigV1.Info))) !== JSON.stringify(patch)
}

function formatPath(path: ReadonlyArray<string | number>): string {
  return path
    .map((segment, index) => (typeof segment === "number" ? `[${segment}]` : index === 0 ? segment : `.${segment}`))
    .join("")
}

function parseSource(filepath: string, text: string, kind: string): Record<string, unknown> {
  const errors: ParseError[] = []
  const parsed: unknown = parse(text, errors, { allowTrailingComma: true })
  if (errors.length > 0 || typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`${kind} ${filepath} is not a valid JSON or JSONC object`)
  return parsed as Record<string, unknown>
}

async function readExistingConfig(filepath: string): Promise<Record<string, unknown> | undefined> {
  const file = Bun.file(filepath)
  if (!(await file.exists())) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    // Parse errors carry no content, but keep diagnostics fixed and generic anyway.
    throw new Error(
      `Existing profile config ${filepath} could not be parsed as JSON (JSONC comments are not supported by this import)`,
    )
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new Error(`Existing profile config ${filepath} must contain a JSON object`)
  return parsed as Record<string, unknown>
}

async function writeConfig(layout: Layout, value: Record<string, unknown>) {
  preflight(layout)
  await mkdir(path.dirname(layout.config), { recursive: true, mode: 0o700 })
  const temporary = `${layout.config}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 })
    preflight(layout)
    await rename(temporary, layout.config)
  } finally {
    await rm(temporary, { force: true })
  }
}

async function readSource(filepath: string): Promise<{ facts: ImportSourceFacts; text: string }> {
  const info = await stat(filepath).catch(() => fail(`v1 import source not found: ${filepath}`))
  if (!info.isFile()) fail(`v1 import source must be a regular file: ${filepath}`)
  // The stat above can miss a path swapped to a FIFO before the open; O_NONBLOCK
  // keeps that open from hanging instead of blocking until a writer connects.
  const handle = await open(filepath, constants.O_RDONLY | constants.O_NONBLOCK).catch(() =>
    fail(`v1 import source not readable: ${filepath}`),
  )
  try {
    const attached = await handle.stat()
    if (!attached.isFile() || attached.size > IMPORT_SOURCE_MAX_BYTES)
      fail(`v1 import source must be a regular file of at most 10 MiB: ${filepath}`)
    const bytes = Buffer.alloc(attached.size)
    let offset = 0
    while (offset < bytes.length) {
      const read = await handle.read(bytes, offset, bytes.length - offset, offset)
      if (read.bytesRead === 0) break
      offset += read.bytesRead
    }
    const content = bytes.subarray(0, offset)
    return {
      facts: {
        path: filepath,
        bytes: content.byteLength,
        sha256: new Bun.CryptoHasher("sha256").update(content).digest("hex"),
      },
      text: new TextDecoder().decode(content),
    }
  } finally {
    await handle.close()
  }
}

function dropUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T
}

function refused(plan: ImportPlan, reason: string): ImportResult {
  return { status: "refused", plan, reason }
}

function credentialBlockReason(blocked: ReadonlyArray<Extract<CredentialDecision, { supported: false }>>): string {
  return blocked.map((entry) => `Credential "${entry.source}" blocks this import: ${entry.reason}`).join("; ")
}

function unmappedBlockReason(unmapped: ReadonlyArray<Extract<ConfigKeyDecision, { supported: false }>>): string {
  return unmapped.map((key) => `Config key "${key.key}" blocks this import: ${key.reason}`).join("; ")
}

function fail(message: string): never {
  throw new Error(message)
}
