export * as ConfigAgentV1 from "./agent"

import { Schema, SchemaGetter } from "effect"
import { PositiveInt } from "../../schema"
import { ConfigPermissionV1 } from "./permission"

const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

// kilocode_change start - agent skill/MCP/VS Code extension requirements schema
const RequirementID = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(128),
  Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
)
const RequirementName = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128), Schema.isPattern(/\S/))

export const VSCodeExtension = Schema.Struct({
  name: RequirementName,
  id: RequirementID,
})
export type VSCodeExtension = Schema.Schema.Type<typeof VSCodeExtension>

const RequirementGroup = Schema.mutable(Schema.Array(RequirementName)).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20),
)
const VSCodeExtensions = Schema.mutable(Schema.Array(VSCodeExtension)).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(20),
)

export const Requirements = Schema.Struct({
  skills: Schema.optional(RequirementGroup),
  mcps: Schema.optional(RequirementGroup),
  vscode_extensions: Schema.optional(VSCodeExtensions),
}).check(
  Schema.makeFilter((input) => {
    const issues: Schema.FilterIssue[] = []
    if (!input.skills && !input.mcps && !input.vscode_extensions) {
      issues.push({ path: [], issue: "At least one requirement group is required" })
    }

    for (const group of ["skills", "mcps"] as const) {
      const seen = new Set<string>()
      for (const [index, value] of (input[group] ?? []).entries()) {
        if (seen.has(value)) issues.push({ path: [group, index], issue: `Duplicate ${group} requirement` })
        seen.add(value)
      }
    }

    const seen = new Set<string>()
    for (const [index, extension] of (input.vscode_extensions ?? []).entries()) {
      if (seen.has(extension.id)) {
        issues.push({ path: ["vscode_extensions", index, "id"], issue: "Duplicate vscode_extensions requirement" })
      }
      seen.add(extension.id)
    }

    return issues
  }),
)
export type Requirements = Schema.Schema.Type<typeof Requirements>
// kilocode_change end

const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(Schema.NullOr(Schema.String)), // kilocode_change - nullable for delete sentinel
    // kilocode_change start - nullable for delete sentinel
    variant: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "Default model variant for this agent (applies only when using the agent's configured model).",
    }),
    // kilocode_change end
    temperature: Schema.optional(Schema.NullOr(Schema.Finite)), // kilocode_change - nullable for delete sentinel
    top_p: Schema.optional(Schema.NullOr(Schema.Finite)), // kilocode_change - nullable for delete sentinel
    prompt: Schema.optional(Schema.NullOr(Schema.String)), // kilocode_change - nullable for delete sentinel
    tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
      description: "@deprecated Use 'permission' field instead",
    }),
    disable: Schema.optional(Schema.Boolean),
    // kilocode_change start - nullable for delete sentinel
    description: Schema.optional(Schema.NullOr(Schema.String)).annotate({
      description: "Description of when to use the agent",
    }),
    // kilocode_change end
    mode: Schema.optional(Schema.Literals(["subagent", "primary", "all"])),
    // kilocode_change start - typed metadata carriers so they never fall into `options` (provider params)
    displayName: Schema.optional(Schema.String).annotate({
      description: "Human-readable name shown in the UI (e.g. for organization or marketplace agents)",
    }),
    source: Schema.optional(Schema.String).annotate({
      description: "Origin marker for managed agents (organization | global | project)",
    }),
    // kilocode_change end
    hidden: Schema.optional(Schema.Boolean).annotate({
      description: "Hide this subagent from the @ autocomplete menu (default: false, only applies to mode: subagent)",
    }),
    options: Schema.optional(Schema.Record(Schema.String, Schema.Any)),
    color: Schema.optional(Color).annotate({
      description: "Hex color code (e.g., #FF5733) or theme color (e.g., primary)",
    }),
    // kilocode_change start - nullable for delete sentinel
    steps: Schema.optional(Schema.NullOr(PositiveInt)).annotate({
      description: "Maximum number of agentic iterations before forcing text-only response",
    }),
    // kilocode_change end
    maxSteps: Schema.optional(PositiveInt).annotate({ description: "@deprecated Use 'steps' field instead." }),
    permission: Schema.optional(ConfigPermissionV1.Info),
    requirements: Schema.optional(Requirements), // kilocode_change
  }),
  [Schema.Record(Schema.String, Schema.Any)],
)

const KNOWN_KEYS = new Set([
  "name",
  "model",
  "variant",
  "prompt",
  "description",
  "temperature",
  "top_p",
  "mode",
  "displayName", // kilocode_change
  "source", // kilocode_change
  "hidden",
  "color",
  "steps",
  "maxSteps",
  "options",
  "permission",
  "disable",
  "tools",
  "requirements", // kilocode_change
])

const normalize = (agent: Schema.Schema.Type<typeof AgentSchema>): Schema.Schema.Type<typeof AgentSchema> => {
  const options: Record<string, unknown> = { ...agent.options }
  for (const [key, value] of Object.entries(agent)) {
    if (!KNOWN_KEYS.has(key)) options[key] = value
  }

  const permission: ConfigPermissionV1.Info = {}
  for (const [tool, enabled] of Object.entries(agent.tools ?? {})) {
    const action = enabled ? "allow" : "deny"
    if (tool === "write" || tool === "edit" || tool === "patch") {
      permission.edit = action
      continue
    }
    permission[tool] = action
  }
  globalThis.Object.assign(permission, agent.permission)

  // kilocode_change start - preserve null delete sentinel (?? would collapse null to maxSteps)
  const steps = agent.steps !== undefined ? agent.steps : agent.maxSteps
  return { ...agent, options, permission, ...(steps !== undefined ? { steps } : {}) }
  // kilocode_change end
}

export const Info = AgentSchema.pipe(
  Schema.decodeTo(AgentSchema, {
    decode: SchemaGetter.transform(normalize),
    encode: SchemaGetter.passthrough({ strict: false }),
  }),
).annotate({ identifier: "AgentConfig" })
export type Info = Schema.Schema.Type<typeof Info>
