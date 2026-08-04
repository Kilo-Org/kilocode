import { Schema } from "effect"

export const Scope = Schema.Literals(["project", "global"])
export type Scope = typeof Scope.Type

export const Kind = Schema.Literals(["mcp", "agent", "skill"])
export type Kind = typeof Kind.Type

export const McpParameter = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  placeholder: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
})
export type McpParameter = typeof McpParameter.Type

export const McpInstallationMethod = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
  parameters: Schema.optional(Schema.Array(McpParameter)),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
})
export type McpInstallationMethod = typeof McpInstallationMethod.Type

// The live catalog ships vscode_extension either as a bare extension id string or
// as a { name, id } object, so accept both to avoid rejecting valid catalog data.
export const VscodeExtensionRef = Schema.Union([
  Schema.String,
  Schema.Struct({ name: Schema.String, id: Schema.String }),
])
export type VscodeExtensionRef = typeof VscodeExtensionRef.Type

export const MarketplaceSuggestFor = Schema.Struct({
  filename: Schema.optional(Schema.Array(Schema.String)),
  vscode_extension: Schema.optional(Schema.Array(VscodeExtensionRef)),
})
export type MarketplaceSuggestFor = typeof MarketplaceSuggestFor.Type

const Base = {
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  category: Schema.String,
  author: Schema.optional(Schema.String),
  authorUrl: Schema.optional(Schema.String),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
  suggest_for: Schema.optional(MarketplaceSuggestFor),
}

export const McpMarketplaceItem = Schema.Struct({
  ...Base,
  type: Schema.Literal("mcp"),
  url: Schema.String,
  content: Schema.Union([Schema.String, Schema.Array(McpInstallationMethod)]),
  parameters: Schema.optional(Schema.Array(McpParameter)),
})
export type McpMarketplaceItem = typeof McpMarketplaceItem.Type

export const AgentContent = Schema.Struct({
  mode: Schema.Literals(["primary", "subagent", "all"]),
  description: Schema.String,
  prompt: Schema.String,
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  requirements: Schema.optional(
    Schema.Struct({
      skills: Schema.optional(Schema.Array(Schema.String)),
      mcps: Schema.optional(Schema.Array(Schema.String)),
      vscode_extensions: Schema.optional(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            id: Schema.String,
          }),
        ),
      ),
    }),
  ),
})
export type AgentContent = typeof AgentContent.Type

export const AgentMarketplaceItem = Schema.Struct({
  ...Base,
  type: Schema.Literal("agent"),
  content: AgentContent,
})
export type AgentMarketplaceItem = typeof AgentMarketplaceItem.Type

export const RawSkill = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  category: Schema.String,
  githubUrl: Schema.String,
  content: Schema.String,
  suggest_for: Schema.optional(MarketplaceSuggestFor),
})
export type RawSkill = typeof RawSkill.Type

export const SkillMarketplaceItem = Schema.Struct({
  ...Base,
  type: Schema.Literal("skill"),
  githubUrl: Schema.String,
  content: Schema.String,
  displayName: Schema.String,
  displayCategory: Schema.String,
})
export type SkillMarketplaceItem = typeof SkillMarketplaceItem.Type

export const MarketplaceItem = Schema.Union([McpMarketplaceItem, AgentMarketplaceItem, SkillMarketplaceItem])
export type MarketplaceItem = typeof MarketplaceItem.Type

export const MarketplaceItemRef = Schema.Struct({
  id: Schema.String,
  type: Kind,
})
export type MarketplaceItemRef = typeof MarketplaceItemRef.Type

export const MarketplaceInstalledMetadata = Schema.Struct({
  project: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
  global: Schema.Record(Schema.String, Schema.Struct({ type: Schema.String })),
})
export type MarketplaceInstalledMetadata = typeof MarketplaceInstalledMetadata.Type

export const MarketplaceListResult = Schema.Struct({
  items: Schema.Array(MarketplaceItem),
  installed: MarketplaceInstalledMetadata,
  errors: Schema.optional(Schema.Array(Schema.String)),
})
export type MarketplaceListResult = typeof MarketplaceListResult.Type

export const MarketplaceInstallPayload = Schema.Struct({
  item: MarketplaceItem,
  target: Schema.optional(Scope),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type MarketplaceInstallPayload = typeof MarketplaceInstallPayload.Type

export const MarketplaceRemovePayload = Schema.Struct({
  item: MarketplaceItemRef,
  scope: Scope,
})
export type MarketplaceRemovePayload = typeof MarketplaceRemovePayload.Type

export const MarketplaceInstallResult = Schema.Struct({
  success: Schema.Boolean,
  slug: Schema.String,
  error: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
})
export type MarketplaceInstallResult = typeof MarketplaceInstallResult.Type

export const MarketplaceRemoveResult = Schema.Struct({
  success: Schema.Boolean,
  slug: Schema.String,
  error: Schema.optional(Schema.String),
})
export type MarketplaceRemoveResult = typeof MarketplaceRemoveResult.Type
