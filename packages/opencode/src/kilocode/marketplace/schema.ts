import { Schema } from "effect"

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const semver =
  /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const revision = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const digest = /^sha256:[0-9a-f]{64}$/
const sequence = /^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[1-9][0-9]*$/
const env = /^[A-Z_][A-Z0-9_]*$/
const etag = /^[^\u0000-\u001f\u007f]{1,1024}$/

function https(value: string) {
  if (!URL.canParse(value)) return false
  const url = new URL(value)
  return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password
}

export const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024
export const MAX_MANIFEST_BYTES = 5 * 1024 * 1024
export const MAX_EXTRACTED_BYTES = 100 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 2_048

export const MarketplaceId = Schema.String.check(
  Schema.isPattern(slug, { message: "Expected a lowercase kebab-case Marketplace ID" }),
).pipe(Schema.brand("MarketplaceId"))
export type MarketplaceId = typeof MarketplaceId.Type

export const MethodId = Schema.String.check(
  Schema.isPattern(slug, { message: "Expected a lowercase kebab-case method ID" }),
).pipe(Schema.brand("MarketplaceMethodId"))
export type MethodId = typeof MethodId.Type

export const ParameterId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_]*$/, { message: "Expected a lowercase parameter ID" }),
).pipe(Schema.brand("MarketplaceParameterId"))
export type ParameterId = typeof ParameterId.Type

export const EnvironmentName = Schema.String.check(
  Schema.isPattern(env, { message: "Expected an uppercase environment variable name" }),
).pipe(Schema.brand("MarketplaceEnvironmentName"))
export type EnvironmentName = typeof EnvironmentName.Type

export const Version = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.makeFilter((value) =>
    semver.test(value) || !/[\u0000-\u001f\u007f]/.test(value)
      ? undefined
      : "Expected a Marketplace version without control characters",
  ),
).pipe(Schema.brand("MarketplaceVersion"))
export type Version = typeof Version.Type

export const SourceRevision = Schema.String.check(
  Schema.isPattern(revision, { message: "Expected an immutable 40 or 64 character source revision" }),
).pipe(Schema.brand("MarketplaceSourceRevision"))
export type SourceRevision = typeof SourceRevision.Type

export const Digest = Schema.String.check(
  Schema.isPattern(digest, { message: "Expected a lowercase sha256 digest" }),
).pipe(Schema.brand("MarketplaceDigest"))
export type Digest = typeof Digest.Type

export const ManifestRevision = Schema.String.check(
  Schema.makeFilter((value) =>
    sequence.test(value) || digest.test(value)
      ? undefined
      : "Expected a date-sequence revision or observed sha256 digest",
  ),
).pipe(Schema.brand("MarketplaceManifestRevision"))
export type ManifestRevision = typeof ManifestRevision.Type

export const HttpsUrl = Schema.String.check(
  Schema.makeFilter((value) => (https(value) ? undefined : "Expected an HTTPS URL without embedded credentials")),
).pipe(Schema.brand("MarketplaceHttpsUrl"))
export type HttpsUrl = typeof HttpsUrl.Type

export const EntityTag = Schema.String.check(Schema.isPattern(etag)).pipe(Schema.brand("MarketplaceEntityTag"))
export type EntityTag = typeof EntityTag.Type

export const NonEmptyText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))
export const TemplateText = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8_192))
export const PositiveInt = Schema.Int.check(Schema.isGreaterThan(0))
export const ArtifactSize = PositiveInt.check(Schema.isLessThanOrEqualTo(MAX_ARTIFACT_BYTES))

export const Trust = Schema.Literals(["first-party", "verified", "community", "unverified"])
export type Trust = typeof Trust.Type
export const Maturity = Schema.Literals(["stable", "preview", "experimental", "unsupported"])
export type Maturity = typeof Maturity.Type
export const Support = Schema.Literals(["kilo", "publisher", "community", "unsupported"])
export type Support = typeof Support.Type

export const Publisher = Schema.Struct({
  id: MarketplaceId,
  name: NonEmptyText,
  trust: Trust,
  url: Schema.optional(HttpsUrl),
})
export type Publisher = typeof Publisher.Type

export const Installability = Schema.Struct({
  installable: Schema.Boolean,
  reason: Schema.optional(NonEmptyText),
})
export type Installability = typeof Installability.Type

export const Artifact = Schema.Struct({
  url: HttpsUrl,
  digest: Digest,
  size: ArtifactSize,
  format: Schema.Literal("tar.gz"),
})
export type Artifact = typeof Artifact.Type

export const ParameterValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
export type ParameterValue = typeof ParameterValue.Type

export const Parameter = Schema.Struct({
  id: ParameterId,
  name: NonEmptyText,
  description: Schema.optional(NonEmptyText),
  type: Schema.Literals(["string", "path", "url", "integer", "boolean"]),
  required: Schema.Boolean,
  sensitive: Schema.Boolean,
  environment: Schema.optional(EnvironmentName),
  default: Schema.optional(ParameterValue),
  allowed_values: Schema.optional(Schema.NonEmptyArray(ParameterValue)),
})
export type Parameter = typeof Parameter.Type

export const OAuthTemplate = Schema.Struct({
  clientId: Schema.optional(TemplateText),
  clientSecret: Schema.optional(TemplateText),
  scope: Schema.optional(TemplateText),
  callbackPort: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))),
  redirectUri: Schema.optional(TemplateText),
})
export type OAuthTemplate = typeof OAuthTemplate.Type

export const LocalTemplate = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.NonEmptyArray(TemplateText),
  environment: Schema.optional(Schema.Record(EnvironmentName, TemplateText)),
  enabled: Schema.Literal(false),
  timeout: Schema.optional(PositiveInt),
})
export type LocalTemplate = typeof LocalTemplate.Type

export const RemoteTemplate = Schema.Struct({
  type: Schema.Literal("remote"),
  url: TemplateText,
  headers: Schema.optional(Schema.Record(Schema.String, TemplateText)),
  oauth: Schema.optional(Schema.Union([OAuthTemplate, Schema.Literal(false)])),
  enabled: Schema.Literal(false),
  timeout: Schema.optional(PositiveInt),
})
export type RemoteTemplate = typeof RemoteTemplate.Type

export const McpTemplate = Schema.Union([LocalTemplate, RemoteTemplate])
export type McpTemplate = typeof McpTemplate.Type

export const McpMethod = Schema.Struct({
  id: MethodId,
  name: NonEmptyText,
  template: McpTemplate,
  parameters: Schema.Array(Parameter),
  prerequisites: Schema.Array(NonEmptyText),
  platforms: Schema.NonEmptyArray(Schema.Literals(["darwin", "linux", "win32"])),
  auth: Schema.Struct({
    mode: Schema.Literals(["none", "environment", "oauth"]),
    environment: Schema.optional(Schema.Array(EnvironmentName)),
  }),
  warnings: Schema.Struct({
    writes: Schema.Boolean,
    text: Schema.optional(NonEmptyText),
  }),
})
export type McpMethod = typeof McpMethod.Type

const common = {
  id: MarketplaceId,
  version: Schema.optional(Version),
  source_revision: Schema.optional(SourceRevision),
  name: Schema.optional(NonEmptyText),
  description: NonEmptyText,
  publisher: Schema.optional(Publisher),
  maturity: Schema.optional(Maturity),
  support: Schema.optional(Support),
  source_url: Schema.optional(HttpsUrl),
  installability: Installability,
  tags: Schema.optional(Schema.Array(MarketplaceId)),
}

export const SkillItem = Schema.Struct({
  ...common,
  kind: Schema.Literal("skill"),
  artifact: Schema.optional(Artifact),
})
export type SkillItem = typeof SkillItem.Type

export const McpItem = Schema.Struct({
  ...common,
  kind: Schema.Literal("mcp"),
  methods: Schema.Array(McpMethod),
})
export type McpItem = typeof McpItem.Type

export const Item = Schema.Union([SkillItem, McpItem])
export type Item = typeof Item.Type

export const Manifest = Schema.Struct({
  version: Schema.Literal(1),
  revision: ManifestRevision,
  items: Schema.Array(Item),
})
export type Manifest = typeof Manifest.Type

export const CacheEntry = Schema.Struct({
  version: Schema.Literal(1),
  endpoint: Schema.String,
  etag: Schema.optional(EntityTag),
  manifest: Manifest,
  fingerprint: Digest,
  history: Schema.optional(Schema.Record(Schema.String, Digest)),
})
export type CacheEntry = typeof CacheEntry.Type

export const ResolvedLocal = Schema.Struct({
  type: Schema.Literal("local"),
  command: Schema.NonEmptyArray(Schema.String),
  environment: Schema.optional(Schema.Record(EnvironmentName, Schema.String)),
  enabled: Schema.Literal(false),
  timeout: Schema.optional(PositiveInt),
})
export type ResolvedLocal = typeof ResolvedLocal.Type

export const ResolvedRemote = Schema.Struct({
  type: Schema.Literal("remote"),
  url: Schema.String,
  headers: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  oauth: Schema.optional(
    Schema.Union([
      Schema.Struct({
        clientId: Schema.optional(Schema.String),
        clientSecret: Schema.optional(Schema.String),
        scope: Schema.optional(Schema.String),
        callbackPort: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))),
        redirectUri: Schema.optional(Schema.String),
      }),
      Schema.Literal(false),
    ]),
  ),
  enabled: Schema.Literal(false),
  timeout: Schema.optional(PositiveInt),
})
export type ResolvedRemote = typeof ResolvedRemote.Type

export const ResolvedMcp = Schema.Union([ResolvedLocal, ResolvedRemote])
export type ResolvedMcp = typeof ResolvedMcp.Type
