import { Schema, SchemaTransformation } from "effect"
import { Item as MarketplaceItem } from "../marketplace/schema"

export namespace Stack {
  const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
  const reference = /^(?:skill|mcp):[a-z0-9]+(?:-[a-z0-9]+)*$/
  const parameter = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/
  const hash = /^sha256:[0-9a-f]{64}$/
  const kebab = Schema.isPattern(slug)
  const qualified = Schema.isPattern(reference)
  const https = Schema.isPattern(/^https:\/\/[^\s]+$/)
  const sha256 = Schema.isPattern(hash)

  function keys(pattern: RegExp) {
    return Schema.makeFilter<Readonly<Record<string, unknown>>>((value) =>
      Object.keys(value).every((key) => pattern.test(key)) ? undefined : "Invalid record key",
    )
  }

  export const VerticalID = Schema.String.check(kebab).pipe(Schema.brand("StackVerticalID"))
  export type VerticalID = Schema.Schema.Type<typeof VerticalID>

  export const CategoryID = Schema.String.check(kebab).pipe(Schema.brand("StackCategoryID"))
  export type CategoryID = Schema.Schema.Type<typeof CategoryID>

  export const TechnologyID = Schema.String.check(kebab).pipe(Schema.brand("StackTechnologyID"))
  export type TechnologyID = Schema.Schema.Type<typeof TechnologyID>

  export const ResourceID = Schema.String.check(kebab).pipe(Schema.brand("StackResourceID"))
  export type ResourceID = Schema.Schema.Type<typeof ResourceID>

  export const MethodID = Schema.String.check(kebab).pipe(Schema.brand("StackMethodID"))
  export type MethodID = Schema.Schema.Type<typeof MethodID>

  export const ParameterID = Schema.String.check(Schema.isPattern(parameter)).pipe(Schema.brand("StackParameterID"))
  export type ParameterID = Schema.Schema.Type<typeof ParameterID>

  export const ResourceRef = Schema.String.check(qualified).pipe(Schema.brand("StackResourceRef"))
  export type ResourceRef = Schema.Schema.Type<typeof ResourceRef>

  export const Revision = Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}\.\d+$/)).pipe(
    Schema.brand("StackCatalogRevision"),
  )
  export type Revision = Schema.Schema.Type<typeof Revision>

  export const Digest = Schema.String.check(sha256).pipe(Schema.brand("StackDigest"))
  export type Digest = Schema.Schema.Type<typeof Digest>

  export const ResourceKind = Schema.Literals(["skill", "mcp"])
  export type ResourceKind = Schema.Schema.Type<typeof ResourceKind>

  export const Trust = Schema.Literals(["official", "provider", "community"])
  export type Trust = Schema.Schema.Type<typeof Trust>

  export const Maturity = Schema.Literals(["stable", "preview", "beta", "experimental", "alpha", "unsupported"])
  export type Maturity = Schema.Schema.Type<typeof Maturity>

  export const Source = Schema.String.check(https).pipe(Schema.brand("StackSource"))
  export type Source = Schema.Schema.Type<typeof Source>

  export const ParameterValue = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean])
  export type ParameterValue = Schema.Schema.Type<typeof ParameterValue>

  export const Parameter = Schema.Union([
    Schema.Struct({
      id: ParameterID,
      label: Schema.String,
      required: Schema.Boolean,
      sensitive: Schema.Literal(false),
      description: Schema.optional(Schema.String),
      default: Schema.optional(ParameterValue),
    }),
    Schema.Struct({
      id: ParameterID,
      label: Schema.String,
      required: Schema.Boolean,
      sensitive: Schema.Literal(true),
      env: Schema.String.check(Schema.isPattern(/^[A-Z][A-Z0-9_]*$/)),
      description: Schema.optional(Schema.String),
    }),
  ])
  export type Parameter = Schema.Schema.Type<typeof Parameter>

  export const Resource = Schema.Struct({
    ref: ResourceRef,
    id: ResourceID,
    kind: ResourceKind,
    name: Schema.String,
    trust: Trust,
    maturity: Maturity,
    source: Source,
    warnings: Schema.Array(Schema.String),
    parameters: Schema.optional(Schema.Array(Parameter)),
  })
  export type Resource = Schema.Schema.Type<typeof Resource>

  export const CatalogOrigin = Schema.Literals(["served", "fallback"])
  export type CatalogOrigin = Schema.Schema.Type<typeof CatalogOrigin>

  export const Association = Schema.Struct({
    ref: ResourceRef,
    default: Schema.Boolean,
    /** True when this association is Kilo-curated (authoritative for defaults).
     * False or absent when supplied as an advisory publisher tag. */
    curated: Schema.optional(Schema.Boolean),
    trust: Trust,
    maturity: Maturity,
    source: Source,
    rationale: Schema.String.check(Schema.isMinLength(1)),
    warnings: Schema.Array(Schema.String),
    parameters: Schema.optional(Schema.Array(Parameter)),
    deprecated: Schema.optional(Schema.Boolean),
    replacement: Schema.optional(ResourceRef),
  })
  export type Association = Schema.Schema.Type<typeof Association>

  export const Technology = Schema.Struct({
    id: TechnologyID,
    name: Schema.String,
    resources: Schema.Array(Association),
  })
  export type Technology = Schema.Schema.Type<typeof Technology>

  export const Placement = Schema.Struct({
    technology: TechnologyID,
    note: Schema.optional(Schema.String),
  })
  export type Placement = Schema.Schema.Type<typeof Placement>

  export interface Category {
    readonly id: CategoryID
    readonly name: string
    readonly technologies: ReadonlyArray<Placement>
    readonly categories: ReadonlyArray<Category>
  }

  interface CategoryEncoded {
    readonly id: string
    readonly name: string
    readonly technologies: ReadonlyArray<{ readonly technology: string; readonly note?: string }>
    readonly categories: ReadonlyArray<CategoryEncoded>
  }

  export const Category: Schema.Codec<Category, CategoryEncoded> = Schema.Struct({
    id: CategoryID,
    name: Schema.String,
    technologies: Schema.Array(Placement),
    categories: Schema.Array(Schema.suspend((): Schema.Codec<Category, CategoryEncoded> => Category)),
  })

  export const Vertical = Schema.Struct({
    id: VerticalID,
    name: Schema.String,
    technologies: Schema.Array(Technology),
    categories: Schema.Array(Category),
  })
  export type Vertical = Schema.Schema.Type<typeof Vertical>

  export const Catalog = Schema.Struct({
    revision: Revision,
    verticals: Schema.Array(Vertical),
    resources: Schema.Array(Resource),
  })
  export type Catalog = Schema.Schema.Type<typeof Catalog>

  const TransportTechnologyID = Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(kebab), SchemaTransformation.passthrough()),
  )
  const TransportVerticalID = Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(kebab), SchemaTransformation.passthrough()),
  )
  const TransportResourceID = Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(kebab), SchemaTransformation.passthrough()),
  )
  const TransportMethodID = Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(kebab), SchemaTransformation.passthrough()),
  )
  const TransportRevision = Schema.String.pipe(
    Schema.decodeTo(
      Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}\.\d+$/)),
      SchemaTransformation.passthrough(),
    ),
  )
  const TransportDigest = Schema.String.pipe(
    Schema.decodeTo(Schema.String.check(sha256), SchemaTransformation.passthrough()),
  )

  export const Override = Schema.Struct({
    enabled: Schema.Boolean,
    method: Schema.optionalKey(TransportMethodID),
    parameters: Schema.optionalKey(Schema.Record(Schema.String, ParameterValue).check(keys(parameter))),
  })
  export type Override = Schema.Schema.Type<typeof Override>

  export const Receipt = Schema.Struct({
    marketplace_id: TransportResourceID,
    version: Schema.optionalKey(Schema.String),
    digest: TransportDigest,
    fingerprint: TransportDigest,
  })
  export type Receipt = Schema.Schema.Type<typeof Receipt>

  export const VerticalConfig = Schema.Struct({
    technologies: Schema.mutable(Schema.Array(TransportTechnologyID)),
  })
  export type VerticalConfig = Schema.Schema.Type<typeof VerticalConfig>

  export const Config = Schema.Struct({
    version: Schema.Literal(1),
    catalog_revision: TransportRevision,
    verticals: Schema.Record(Schema.String, VerticalConfig).check(keys(slug)),
    resources: Schema.Record(Schema.String, Override).check(keys(reference)),
    managed: Schema.Record(Schema.String, Receipt).check(keys(reference)),
  })
  export type Config = Schema.Schema.Type<typeof Config>

  export const Draft = Schema.Struct({
    verticals: Schema.Record(Schema.String, VerticalConfig).check(keys(slug)),
    resources: Schema.Record(Schema.String, Override).check(keys(reference)),
  })
  export type Draft = Schema.Schema.Type<typeof Draft>

  export const ActionKind = Schema.Literals([
    "install",
    "remove",
    "keep",
    "already_available_unmanaged",
    "relinquish_modified",
    "missing",
    "blocked",
  ])
  export type ActionKind = Schema.Schema.Type<typeof ActionKind>

  export const Action = Schema.Struct({
    action: ActionKind,
    resource: ResourceRef,
    technologies: Schema.Array(TechnologyID),
    reason: Schema.String,
    warnings: Schema.Array(Schema.String),
    prerequisites: Schema.Array(Schema.String),
  })
  export type Action = Schema.Schema.Type<typeof Action>

  export const ConflictKind = Schema.Literals([
    "invalid_draft",
    "invalid_config",
    "stale_plan",
    "missing_marketplace_resource",
    "marketplace_unavailable",
    "apply_failed",
  ])
  export type ConflictKind = Schema.Schema.Type<typeof ConflictKind>

  export const Conflict = Schema.Struct({
    code: ConflictKind,
    message: Schema.String,
    resource: Schema.optional(ResourceRef),
    action: Schema.optional(ActionKind),
  })
  export type Conflict = Schema.Schema.Type<typeof Conflict>

  export const Plan = Schema.Struct({
    draft: Draft,
    actions: Schema.Array(Action),
    conflicts: Schema.Array(Conflict),
    warnings: Schema.Array(Schema.String),
    prerequisites: Schema.Array(Schema.String),
    config_revision: Digest,
    catalog_revision: Revision,
    plan_hash: Digest,
  })
  export type Plan = Schema.Schema.Type<typeof Plan>

  export const Availability = Schema.Literals(["available", "missing", "blocked"])
  export type Availability = Schema.Schema.Type<typeof Availability>

  export const ResourceSummary = Schema.Struct({
    resource: Resource,
    availability: Availability,
    reason: Schema.optional(Schema.String),
    item: Schema.optional(MarketplaceItem),
  })
  export type ResourceSummary = Schema.Schema.Type<typeof ResourceSummary>

  export const CatalogResponse = Schema.Struct({
    catalog: Catalog,
    resources: Schema.Array(ResourceSummary),
    expected_resources: Schema.Array(ResourceRef),
    /** Indicates whether the catalog was resolved from the served Marketplace document or the bundled fallback snapshot. */
    catalog_origin: Schema.optional(CatalogOrigin),
  })
  export type CatalogResponse = Schema.Schema.Type<typeof CatalogResponse>

  export const Detection = Schema.Struct({
    technology: TransportTechnologyID,
    vertical: TransportVerticalID,
    evidence: Schema.String,
  })
  export type Detection = Schema.Schema.Type<typeof Detection>

  export const DetectionResponse = Schema.Struct({
    detections: Schema.Array(Detection),
  })
  export type DetectionResponse = Schema.Schema.Type<typeof DetectionResponse>

  export const Drift = Schema.Literals(["none", "missing", "modified", "desired"])
  export type Drift = Schema.Schema.Type<typeof Drift>

  export const ResourceState = Schema.Struct({
    resource: ResourceRef,
    enabled: Schema.Boolean,
    managed: Schema.Boolean,
    inherited: Schema.Boolean,
    drift: Drift,
  })
  export type ResourceState = Schema.Schema.Type<typeof ResourceState>

  export const StateResponse = Schema.Struct({
    config: Schema.optional(Config),
    draft: Draft,
    resources: Schema.Array(ResourceState),
    conflicts: Schema.Array(Conflict),
    config_revision: Digest,
    catalog_revision: Revision,
  })
  export type StateResponse = Schema.Schema.Type<typeof StateResponse>

  export const PreviewInput = Schema.Struct({ draft: Draft })
  export type PreviewInput = Schema.Schema.Type<typeof PreviewInput>

  export const PreviewResponse = Plan
  export type PreviewResponse = Plan

  export const ApplyInput = Schema.Struct({
    draft: Draft,
    plan_hash: Digest,
  })
  export type ApplyInput = Schema.Schema.Type<typeof ApplyInput>

  export const Result = Schema.Struct({
    resource: ResourceRef,
    action: ActionKind,
    success: Schema.Boolean,
    message: Schema.String,
  })
  export type Result = Schema.Schema.Type<typeof Result>

  export const ApplyResponse = Schema.Struct({
    results: Schema.Array(Result),
    state: StateResponse,
  })
  export type ApplyResponse = Schema.Schema.Type<typeof ApplyResponse>
}
