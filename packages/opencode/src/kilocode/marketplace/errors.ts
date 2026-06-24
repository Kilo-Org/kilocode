import { Schema } from "effect"

export class MarketplaceEndpointError extends Schema.TaggedErrorClass<MarketplaceEndpointError>()(
  "MarketplaceEndpointError",
  { reason: Schema.Literals(["invalid_url", "insecure_url"]) },
) {}

export class MarketplaceUnavailableError extends Schema.TaggedErrorClass<MarketplaceUnavailableError>()(
  "MarketplaceUnavailableError",
  {
    reason: Schema.Literals(["network", "http_status", "not_modified_without_cache"]),
    status: Schema.optional(Schema.Number),
  },
) {}

export class MarketplaceManifestError extends Schema.TaggedErrorClass<MarketplaceManifestError>()(
  "MarketplaceManifestError",
  {
    reason: Schema.Literals([
      "invalid_json",
      "invalid_yaml",
      "invalid_schema",
      "duplicate_item",
      "invalid_installability",
      "duplicate_method",
      "duplicate_parameter",
      "invalid_parameter",
      "unsafe_template",
      "mutable_revision",
      "mutable_item",
      "stale_revision",
      "body_too_large",
    ]),
    item: Schema.optional(Schema.String),
  },
) {}

export class MarketplaceCacheError extends Schema.TaggedErrorClass<MarketplaceCacheError>()("MarketplaceCacheError", {
  operation: Schema.Literals(["create", "write", "rename"]),
}) {}

export class MarketplaceResourceError extends Schema.TaggedErrorClass<MarketplaceResourceError>()(
  "MarketplaceResourceError",
  {
    kind: Schema.Literals(["skill", "mcp"]),
    id: Schema.String,
  },
) {}

export class McpResolutionError extends Schema.TaggedErrorClass<McpResolutionError>()("McpResolutionError", {
  id: Schema.String,
  method: Schema.String,
  reason: Schema.Literals([
    "not_installable",
    "method_not_found",
    "unknown_parameter",
    "sensitive_parameter",
    "missing_parameter",
    "invalid_parameter",
    "unsafe_value",
    "unsafe_template",
    "insecure_remote_url",
  ]),
  parameter: Schema.optional(Schema.String),
}) {}

export class SkillDownloadError extends Schema.TaggedErrorClass<SkillDownloadError>()("SkillDownloadError", {
  id: Schema.String,
  reason: Schema.Literals(["not_installable", "network", "http_status", "body_too_large"]),
  status: Schema.optional(Schema.Number),
}) {}

export class SkillIntegrityError extends Schema.TaggedErrorClass<SkillIntegrityError>()("SkillIntegrityError", {
  id: Schema.String,
  reason: Schema.Literals(["size", "digest"]),
  expected: Schema.String,
  actual: Schema.String,
}) {}

export class SkillArchiveError extends Schema.TaggedErrorClass<SkillArchiveError>()("SkillArchiveError", {
  id: Schema.String,
  reason: Schema.Literals([
    "invalid_gzip",
    "invalid_header",
    "invalid_checksum",
    "unsupported_entry",
    "link",
    "unsafe_path",
    "too_large",
    "too_many_entries",
    "duplicate_path",
    "missing_skill",
    "invalid_skill",
    "filesystem",
  ]),
  entry: Schema.optional(Schema.String),
}) {}

export class SkillInstallError extends Schema.TaggedErrorClass<SkillInstallError>()("SkillInstallError", {
  id: Schema.String,
  reason: Schema.Literals([
    "not_installable",
    "invalid_item",
    "invalid_project",
    "invalid_stage",
    "unsafe_destination",
    "already_installed",
    "filesystem",
  ]),
}) {}
