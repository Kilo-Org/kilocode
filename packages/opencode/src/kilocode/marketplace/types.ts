import { Schema } from "effect"

export const Target = Schema.Literals(["global", "project"])
export type Target = typeof Target.Type

export const Type = Schema.Literals(["agent", "mcp", "skill"])
export type Type = typeof Type.Type

export const Parameter = Schema.Struct({
  name: Schema.String,
  key: Schema.String,
  placeholder: Schema.optional(Schema.String),
  optional: Schema.optional(Schema.Boolean),
})

export const Method = Schema.Struct({
  name: Schema.String,
  content: Schema.String,
  parameters: Schema.optional(Schema.Array(Parameter)),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
})
export type Method = typeof Method.Type

const Base = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  author: Schema.optional(Schema.String),
  authorUrl: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
})

export const McpItem = Schema.Struct({
  ...Base.fields,
  type: Schema.Literal("mcp"),
  url: Schema.String,
  content: Schema.Union([Schema.String, Schema.Array(Method)]),
  parameters: Schema.optional(Schema.Array(Parameter)),
})
export type McpItem = typeof McpItem.Type

export const AgentContent = Schema.Struct({
  mode: Schema.Literals(["primary", "subagent", "all"]),
  description: Schema.String,
  prompt: Schema.String,
  options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  permission: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type AgentContent = typeof AgentContent.Type

export const AgentItem = Schema.Struct({
  ...Base.fields,
  type: Schema.Literal("agent"),
  content: AgentContent,
})
export type AgentItem = typeof AgentItem.Type

export const RawSkill = Schema.Struct({
  id: Schema.String,
  description: Schema.String,
  category: Schema.String,
  githubUrl: Schema.String,
  content: Schema.String,
})
export type RawSkill = typeof RawSkill.Type

export const SkillItem = Schema.Struct({
  ...Base.fields,
  type: Schema.Literal("skill"),
  category: Schema.String,
  githubUrl: Schema.String,
  content: Schema.String,
  displayName: Schema.String,
  displayCategory: Schema.String,
})
export type SkillItem = typeof SkillItem.Type

export const Item = Schema.Union([McpItem, AgentItem, SkillItem])
export type Item = typeof Item.Type

export const Metadata = Schema.Struct({
  project: Schema.Record(Schema.String, Schema.Struct({ type: Type })),
  global: Schema.Record(Schema.String, Schema.Struct({ type: Type })),
})
export type Metadata = typeof Metadata.Type

export const Response = Schema.Struct({
  marketplaceItems: Schema.Array(Item),
  marketplaceInstalledMetadata: Metadata,
  errors: Schema.optional(Schema.Array(Schema.String)),
})
export type Response = typeof Response.Type

export const InstallPayload = Schema.Struct({
  id: Schema.String,
  type: Type,
  target: Schema.optional(Target),
  parameters: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
})
export type InstallPayload = typeof InstallPayload.Type

export const UninstallPayload = Schema.Struct({
  id: Schema.String,
  type: Type,
  target: Target,
})
export type UninstallPayload = typeof UninstallPayload.Type

export const InstallResult = Schema.Struct({
  success: Schema.Boolean,
  slug: Schema.String,
  error: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
})
export type InstallResult = typeof InstallResult.Type

export const RemoveResult = Schema.Struct({
  success: Schema.Boolean,
  slug: Schema.String,
  error: Schema.optional(Schema.String),
})
export type RemoveResult = typeof RemoveResult.Type
