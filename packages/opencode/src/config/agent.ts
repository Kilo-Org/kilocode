export * as ConfigAgent from "./agent"

export type { Warning } from "./config" // kilocode_change

import path from "path"
import { Schema, SchemaGetter } from "effect"
import { PositiveInt } from "@opencode-ai/core/schema"
import * as Log from "@opencode-ai/core/util/log"
import { Glob } from "@opencode-ai/core/util/glob"
import { configEntryNameFromPath } from "./entry-name"
import { ConfigError } from "./error"
import * as ConfigMarkdown from "./markdown"
import { ConfigModelID } from "./model-id"
import { ConfigParse } from "./parse"
import { ConfigPermission } from "./permission"
import { ConfigVariable } from "./variable" // kilocode_change
// kilocode_change start
import { Bus } from "@/bus"
import { NamedError } from "@opencode-ai/core/util/error"
import { KilocodeConfig } from "@/kilocode/config/config"
import type { Warning } from "./config"
import { Requirements } from "@/kilocode/agent-requirements"
// kilocode_change end

const log = Log.create({ service: "config" })

const Color = Schema.Union([
  Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/)),
  Schema.Literals(["primary", "secondary", "accent", "success", "warning", "error", "info"]),
])

const AgentSchema = Schema.StructWithRest(
  Schema.Struct({
    model: Schema.optional(Schema.NullOr(ConfigModelID)), // kilocode_change - nullable for delete sentinel
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
    permission: Schema.optional(ConfigPermission.Info),
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

// Post-parse normalisation:
//  - Promote any unknown-but-present keys into `options` so they survive the
//    round-trip in a well-known field.
//  - Translate the deprecated `tools: { name: boolean }` map into the new
//    `permission` shape (write-adjacent tools collapse into `permission.edit`).
//  - Coalesce `steps ?? maxSteps` so downstream can ignore the deprecated alias.
const normalize = (agent: Schema.Schema.Type<typeof AgentSchema>): Schema.Schema.Type<typeof AgentSchema> => {
  const options: Record<string, unknown> = { ...agent.options }
  for (const [key, value] of Object.entries(agent)) {
    if (!KNOWN_KEYS.has(key)) options[key] = value
  }

  const permission: ConfigPermission.Info = {}
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

// kilocode_change start - trusted gates {env:}; fileScope confines untrusted agent prompt {file:} reads
export async function load(dir: string, warnings?: Warning[], trusted?: boolean, fileScope?: ConfigVariable.FileScope) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{agent,agents}/**/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse agent ${item}`
      // kilocode_change start
      const detail = ConfigMarkdown.FrontmatterError.isInstance(err) ? err.data.message : undefined
      if (warnings) warnings.push({ path: item, message, detail })
      try {
        const { capture } = await import("@/kilocode/instance")
        const ctx = capture()
        if (ctx) {
          const { Session } = await import("@/session/session")
          await Bus.publish(ctx, Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        }
      } catch (error) {
        log.warn("could not publish session error", { message, err: error })
      }
      // kilocode_change end
      log.error("failed to load agent", { agent: item, err: message }) // kilocode_change
      return undefined
    })
    if (!md) continue

    const name = configEntryNameFromPath(path.relative(dir, item), ["agent/", "agents/"])

    // kilocode_change start - substitute agent prompt variables relative to the agent file. Project agents are
    // untrusted (no {env:}, {file:} confined to fileScope.root); a rejected substitution must skip only this
    // agent with a warning, not fail the whole config load, mirroring the frontmatter-parse handling above.
    const prompt = await ConfigVariable.substitute({
      text: md.content.trim(),
      type: "virtual",
      dir: path.dirname(item),
      source: item,
      missing: "empty",
      escapeJson: false,
      trusted,
      fileScope,
    }).catch((err): string | undefined => {
      const message =
        (ConfigError.InvalidError.isInstance(err) ? err.data.message : undefined) ??
        `Failed to substitute variables in agent ${item}`
      if (warnings) warnings.push({ path: item, message })
      log.error("failed to substitute agent prompt", { agent: item, err })
      return undefined
    })
    if (prompt === undefined) continue
    const config = {
      name,
      ...md.data,
      prompt,
    }
    // kilocode_change end
    // kilocode_change start - use Effect schema (propertyOrder: original) + non-fatal handleInvalid
    try {
      result[config.name] = ConfigParse.schema(Info, config, item) as Info
    } catch (err) {
      if (ConfigError.InvalidError.isInstance(err)) {
        await KilocodeConfig.handleInvalid("agent", item, err.data.issues ?? [], err, warnings)
        continue
      }
      throw err
    }
    // kilocode_change end
  }
  return result
}

// kilocode_change start
export async function loadMode(dir: string, warnings?: Warning[]) {
  // kilocode_change end
  const result: Record<string, Info> = {}
  for (const item of await Glob.scan("{mode,modes}/*.md", {
    cwd: dir,
    absolute: true,
    dot: true,
    symlink: true,
  })) {
    const md = await ConfigMarkdown.parse(item).catch(async (err) => {
      const message = ConfigMarkdown.FrontmatterError.isInstance(err)
        ? err.data.message
        : `Failed to parse mode ${item}`
      // kilocode_change start
      const detail = ConfigMarkdown.FrontmatterError.isInstance(err) ? err.data.message : undefined
      if (warnings) warnings.push({ path: item, message, detail })
      try {
        const { capture } = await import("@/kilocode/instance")
        const ctx = capture()
        if (ctx) {
          const { Session } = await import("@/session/session")
          await Bus.publish(ctx, Session.Event.Error, { error: new NamedError.Unknown({ message }).toObject() })
        }
      } catch (error) {
        log.warn("could not publish session error", { message, err: error })
      }
      // kilocode_change end
      log.error("failed to load mode", { mode: item, err: message }) // kilocode_change
      return undefined
    })
    if (!md) continue

    const config = {
      name: configEntryNameFromPath(path.relative(dir, item), ["mode/", "modes/"]),
      ...md.data,
      prompt: md.content.trim(),
    }
    // kilocode_change start - use Effect schema (propertyOrder: original) + non-fatal handleInvalid
    try {
      result[config.name] = {
        ...(ConfigParse.schema(Info, config, item) as Info),
        mode: "primary" as const,
      }
    } catch (err) {
      if (ConfigError.InvalidError.isInstance(err)) {
        await KilocodeConfig.handleInvalid("agent", item, err.data.issues ?? [], err, warnings)
        continue
      }
      throw err
    }
    // kilocode_change end
  }
  return result
}
