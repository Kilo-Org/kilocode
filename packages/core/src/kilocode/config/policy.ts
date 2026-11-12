export * as KiloConfigPolicy from "./policy.js"

import { Config } from "@opencode/schema/config"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigModel } from "@opencode/schema/config/model"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { KiloPagesRpc } from "@opencode/schema/kilocode/pages"
import { optional } from "@opencode/schema/schema"
import { Effect, Option, Schema } from "effect"
import type { Interface } from "../../config.js"
import type { ConfigNormalize } from "../../config/normalize.js"
import { KiloConfigExcess } from "./excess.js"

// Allowed hosts are checked by the sandbox plugin, which owns the destination parser.
const Sandbox = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({ description: "Enable sandbox confinement for new sessions" }),
  network: Schema.Literals(["allow", "deny"]).pipe(optional).annotate({
    description: "Control outbound network access from sandboxed tools",
  }),
  writable_paths: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Additional filesystem paths that sandboxed tools may write to",
  }),
  allowed_hosts: Schema.Array(Schema.String).pipe(optional).annotate({
    description: "Exact network destinations sandboxed tools may access while network restriction is enabled",
  }),
})

const Retention = Schema.Struct({
  enabled: Schema.Boolean.pipe(optional).annotate({
    description: "Delete old sessions across all projects and every Kilo client on this machine",
  }),
  maxAgeDays: Schema.Number.pipe(optional).annotate({ description: "Days a session is kept before deletion" }),
})

const ReasoningDisplay = Schema.Literals(["expanded", "preview", "headline"])

export class Info extends Config.Info.extend<Info>("KiloConfigPolicy.Info")({
  session_sync: Schema.Boolean.pipe(optional).annotate({
    description: "Synchronize signed-in Kilo sessions and required assets (default: true; global config only)",
  }),
  hide_prompt_training_models: Schema.Boolean.pipe(optional).annotate({
    description: "Hide Kilo models that can use prompts for training and deny provider data collection",
  }),
  privacy_mode: Schema.Boolean.pipe(optional).annotate({
    description:
      "Blur personally identifiable information (account email, balance, team name, etc.) in the TUI and require confirmation before showing profile details",
  }),
  workflow_models: Schema.Record(Schema.String, ConfigModel.Selection).pipe(optional),
  terminal_command_display: Schema.Literals(["expanded", "collapsed"]).pipe(optional).annotate({
    description: "Controls whether terminal command blocks are expanded or collapsed by default in the VS Code chat UI",
  }),
  code_edit_display: Schema.Literals(["expanded", "collapsed"]).pipe(optional).annotate({
    description:
      "Controls whether code edit and diff blocks are expanded or collapsed by default in the VS Code chat UI",
  }),
  mcp_tool_display: Schema.Literals(["expanded", "collapsed"]).pipe(optional).annotate({
    description:
      "Controls whether MCP and generic tool blocks are expanded or collapsed by default in the VS Code chat UI",
  }),
  code_mode_display: Schema.Literals(["expanded", "collapsed"]).pipe(optional).annotate({
    description:
      "Controls whether Code Mode blocks list their tool calls (expanded) or show one line (collapsed) by default in the VS Code chat UI. The script stays hidden until opened",
  }),
  // kilo_port(unattributed:core/v1:159079a2d8a3)
  remote_control: Schema.Boolean.pipe(optional).annotate({
    description: "Enable remote control of sessions via Kilo Cloud",
  }),
  auto_collapse_reasoning: Schema.Boolean.pipe(optional).annotate({
    description: "@deprecated Use reasoning_display instead. Collapse reasoning blocks once the agent finishes them",
  }),
  reasoning_display: ReasoningDisplay.pipe(optional).annotate({
    description: "How reasoning blocks are displayed",
  }),
  shared_agent_board: Schema.Boolean.pipe(optional).annotate({
    description: "Share a board between a main session and its task subagents, including nested subagents",
  }),
  sandbox: Sandbox.pipe(optional).annotate({ description: "Sandbox configuration for agent tools" }),
  // kilo_port(unattributed:core/v1:a4a32558d64b)
  subagent_model: Schema.NullOr(Schema.String).pipe(optional).annotate({
    description: "Default model for task-tool subagents",
  }),
  subagent_variant: Schema.NullOr(Schema.String).pipe(optional).annotate({
    description: "Default model variant for task-tool subagents when subagent_model is configured",
  }),
  subagent_variant_overrides: Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.String)))
    .pipe(optional)
    .annotate({ description: "Model-specific variant overrides for task-tool subagents, keyed by provider/model" }),
  memory_model: Schema.NullOr(Schema.String).pipe(optional).annotate({
    description: "Model for automatic project memory saves",
  }),
  // kilo_port(unattributed:core/v1:a177a3c0a84c)
  web_search: Schema.Boolean.pipe(optional).annotate({
    description: "Make web search available to models from all providers",
  }),
  // kilo_port(unattributed:core/v1:2e351a955982)
  retention: Retention.pipe(optional).annotate({
    description: "Machine-wide session retention across every Kilo client on this machine",
  }),
  // kilo_port(unattributed:core/v1:fb80dc4c3dd4)
  commit_message: Schema.Struct({
    prompt: Schema.String.pipe(optional).annotate({
      description:
        "Custom system prompt for AI commit message generation. When set, replaces the default conventional commits prompt entirely.",
    }),
  })
    .pipe(optional)
    .annotate({ description: "Configuration for AI-generated commit messages" }),
  // kilo_port(indexing:fe813c19ebaf) kilo_port(indexing:987c9e6c9e85) kilo_port(indexing:854fbb30ce6c)
  indexing: KiloIndexingRpc.Config.pipe(optional),
  pages: KiloPagesRpc.Config.pipe(optional),
}) {}

// The recognized top-level keys: the full v2 schema without the derived `workflow_models` (built from model-only
// `commands`). The writer (`validate.ts`) shares this set so a read and a write cannot drift.
export const known = new Set(Object.keys(Info.fields).filter((key) => key !== "workflow_models"))

const decode = Schema.decodeUnknownOption(Info, { errors: "all", onExcessProperty: "ignore" })
const policy = Schema.Struct({ hide_prompt_training_models: Schema.optional(Schema.Boolean) })
const privacy = Schema.Struct({ privacy_mode: Schema.optional(Schema.Boolean) })
const sync = Schema.Struct({ session_sync: Schema.optional(Schema.Boolean) })
const commit = Schema.Struct({ commit_message: Schema.optional(Schema.Struct({ prompt: Schema.optional(Schema.String) })) })
const indexing = Schema.Struct({ indexing: Schema.optional(KiloIndexingRpc.Config) })
const pages = Schema.Struct({ pages: Schema.optional(KiloPagesRpc.Config) })
const sandboxSetting = Schema.Struct({ sandbox: Schema.optional(Sandbox) })
const decodeModel = Schema.decodeUnknownOption(ConfigModel.Selection)

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

const settings = {
  remote_control: { schema: Schema.Boolean, expected: "a boolean" },
  auto_collapse_reasoning: { schema: Schema.Boolean, expected: "a boolean" },
  reasoning_display: { schema: ReasoningDisplay, expected: 'one of "expanded", "preview", "headline"' },
  shared_agent_board: { schema: Schema.Boolean, expected: "a boolean" },
  sandbox: { schema: Sandbox, expected: "an object with optional enabled, network, writable_paths and allowed_hosts" },
  subagent_model: { schema: Schema.NullOr(Schema.String), expected: "a model string or null" },
  subagent_variant: { schema: Schema.NullOr(Schema.String), expected: "a variant string or null" },
  subagent_variant_overrides: {
    schema: Schema.NullOr(Schema.Record(Schema.String, Schema.NullOr(Schema.String))),
    expected: "a map of provider/model to a variant string or null",
  },
  memory_model: { schema: Schema.NullOr(Schema.String), expected: "a model string or null" },
  web_search: { schema: Schema.Boolean, expected: "a boolean" },
  retention: { schema: Retention, expected: "an object with optional enabled and maxAgeDays" },
} as const

/** Decode each Kilo-only setting on its own, so one invalid field does not drop the others. */
function kiloSettings(input: unknown, report?: (diagnostic: ConfigNormalize.Diagnostic) => void) {
  if (!record(input)) return {}
  return Object.fromEntries(
    Object.entries(settings).flatMap(([key, { schema, expected }]) => {
      const raw = (input as Record<string, unknown>)[key]
      if (raw === undefined) return []
      const value = Option.getOrUndefined(Schema.decodeUnknownOption(schema)(raw))
      if (value === undefined) {
        report?.({ path: [key], kind: "invalid", message: `ignored invalid ${key}; expected ${expected}` })
        return []
      }
      return [[key, value]]
    }),
  )
}

const refused = {
  console: "ignored console; Kilo Console settings are not carried on this build",
} as const

// `workflow_models` is derived from model-only `commands` entries; `refused` keys have their own diagnostic.
const skipExcess = new Set(["workflow_models", ...Object.keys(refused)])

const refusedExperimental = {
  semantic_indexing: "ignored retired experimental.semantic_indexing; use indexing.enabled instead",
  codebase_search: "ignored retired experimental.codebase_search",
  shared_agent_board: "ignored retired experimental.shared_agent_board; use the top-level shared_agent_board key instead",
} as const

/** Report the v1 keys this build accepts from neither the canonical nor the Kilo schema. */
function refusedSettings(input: unknown, report?: (diagnostic: ConfigNormalize.Diagnostic) => void) {
  if (!record(input)) return
  for (const [key, message] of Object.entries(refused))
    if (key in input) report?.({ path: [key], kind: "unsupported", message })
  if (!record(input.experimental)) return
  for (const [key, message] of Object.entries(refusedExperimental))
    if (key in input.experimental) report?.({ path: ["experimental", key], kind: "unsupported", message })
}

function modelOnly(value: unknown) {
  if (!record(value) || !("model" in value) || Object.keys(value).some((key) => key !== "model" && key !== "variant"))
    return
  if (value.variant !== undefined && (typeof value.variant !== "string" || !value.variant || value.variant.includes("#"))) return
  const model =
    typeof value.model === "string" && !value.model.includes("#") && value.variant
      ? `${value.model}#${value.variant}`
      : record(value.model) && value.variant && !value.model.variant
        ? { ...value.model, variant: value.variant }
        : value.model
  return Option.getOrUndefined(decodeModel(model))
}

/** Remove valid model-only entries before the native command schema validates complete definitions. */
export function normalize(input: unknown) {
  if (!record(input)) return input
  return Object.fromEntries(
    Object.entries(input).map(([key, value]) => {
      if ((key !== "command" && key !== "commands") || !record(value)) return [key, value]
      return [key, Object.fromEntries(Object.entries(value).filter(([, command]) => !modelOnly(command)))]
    }),
  )
}

/** Decode Kilo settings alongside the canonical fields produced by upstream normalization. */
export function parse(
  input: unknown,
  normalized: Readonly<Record<string, unknown>>,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
) {
  // A malformed Kilo-only field must not discard canonical managed permission policies.
  const decoded = Schema.decodeUnknownOption(policy)(input)
  if (Option.isNone(decoded))
    report?.({
      path: ["hide_prompt_training_models"],
      kind: "invalid",
      message:
        "ignored invalid hide_prompt_training_models; expected a boolean (true or false), so prompt-training protection was not applied from this field",
    })
  const raw = Option.getOrElse(decoded, () => ({}))
  const privacyField = Schema.decodeUnknownOption(privacy)(input)
  if (Option.isNone(privacyField))
    report?.({
      path: ["privacy_mode"],
      kind: "invalid",
      message:
        "ignored invalid privacy_mode; expected a boolean (true or false), so privacy mode was not changed by this field",
    })
  const message = Schema.decodeUnknownOption(commit)(input)
  if (Option.isNone(message))
    report?.({
      path: ["commit_message"],
      kind: "invalid",
      message: "ignored invalid commit_message; expected an object with an optional string prompt",
    })
  const models = input instanceof Info ? input.workflow_models : record(input) ? workflowModels(input) : undefined
  KiloConfigExcess.report(input, known, skipExcess, report)
  refusedSettings(input, report)
  const decodedSettings = kiloSettings(input, report)
  const synchronization = Schema.decodeUnknownOption(sync)(input)
  if (Option.isNone(synchronization))
    report?.({
      path: ["session_sync"],
      kind: "invalid",
      message: "ignored invalid session_sync; expected a boolean (true or false)",
    })
  const indexingField = Schema.decodeUnknownOption(indexing)(input)
  if (Option.isNone(indexingField))
    report?.({
      path: ["indexing"],
      kind: "invalid",
      message: "ignored invalid indexing; expected the codebase indexing settings object",
    })
  const pagesField = Schema.decodeUnknownOption(pages)(input)
  if (Option.isNone(pagesField))
    report?.({
      path: ["pages"],
      kind: "invalid",
      message: "ignored invalid pages; expected an object with optional enabled and destination (pages or pages-dev)",
    })
  const sandboxField = Schema.decodeUnknownOption(sandboxSetting)(input)
  if (Option.isNone(sandboxField))
    report?.({
      path: ["sandbox"],
      kind: "invalid",
      message: "ignored invalid sandbox; expected an object with optional enabled, network, writable_paths and allowed_hosts",
    })
  // Managed policy splitting clears optional fields with undefined; the encoded schema requires omitted keys.
  return Option.getOrUndefined(
    decode(
      Object.fromEntries(
        Object.entries({
          ...normalized,
          ...raw,
          ...Option.getOrElse(privacyField, () => ({})),
          ...Option.getOrElse(message, () => ({})),
          ...Option.getOrElse(synchronization, () => ({})),
          ...Option.getOrElse(indexingField, () => ({})),
          ...Option.getOrElse(pagesField, () => ({})),
          ...Option.getOrElse(sandboxField, () => ({})),
          ...compactionSettings(input, normalized, report),
          ...displaySettings(input, report),
          ...decodedSettings,
          workflow_models: models && Object.keys(models).length ? models : undefined,
        }).filter(([, value]) => value !== undefined),
      ),
    ),
  )
}

/**
 * A v1 `compaction.threshold_percent` becomes the v2 `buffer`: the share of the window kept free before automatic
 * compaction. An explicit v2 `buffer` (or its `reserved` alias, which normalization folds into `buffer`) wins, because
 * it is the later spelling of the same setting.
 */
function compactionSettings(
  input: unknown,
  normalized: Readonly<Record<string, unknown>>,
  report?: (diagnostic: ConfigNormalize.Diagnostic) => void,
) {
  if (!record(input) || !record(input.compaction)) return {}
  if (!("threshold_percent" in input.compaction)) return {}
  const native = record(normalized.compaction) ? normalized.compaction : {}
  if (native.buffer !== undefined) return {}
  const percent = input.compaction.threshold_percent
  if (percent === null) return {}
  if (typeof percent !== "number" || !Number.isFinite(percent) || percent <= 0 || percent > 100) {
    report?.({
      path: ["compaction", "threshold_percent"],
      kind: "invalid",
      message: "ignored invalid compaction.threshold_percent; expected a percentage from 1 to 100",
    })
    return {}
  }
  const reserved = 100 - percent
  // The buffer percentage accepts 1 to 99, so a fractional limit above 99 keeps the smallest valid reserve instead.
  return { compaction: { ...native, buffer: reserved === 0 ? 0 : reserved < 1 ? "1%" : `${reserved}%` } }
}

/** The display layouts, ignoring an invalid value with a diagnostic instead of failing the whole document. */
function displaySettings(input: unknown, report?: (diagnostic: ConfigNormalize.Diagnostic) => void) {
  if (!record(input)) return {}
  const decodeLayout = Schema.decodeUnknownOption(Schema.Literals(["expanded", "collapsed"]))
  return Object.fromEntries(
    ["terminal_command_display", "code_edit_display", "mcp_tool_display", "code_mode_display"].flatMap((key) => {
      if (input[key] === undefined) return []
      const value = Option.getOrUndefined(decodeLayout(input[key]))
      if (value === undefined)
        report?.({ path: [key], kind: "invalid", message: `ignored invalid ${key}; expected "expanded" or "collapsed"` })
      return value === undefined ? [] : [[key, value]]
    }),
  )
}

function workflowModels(input: Record<string, unknown>) {
  const legacy = record(input.command) ? input.command : {}
  const native = record(input.commands) ? input.commands : {}
  const names = new Set([...Object.keys(legacy), ...Object.keys(native)])
  return Object.fromEntries([...names].flatMap((name) => {
    const command = native[name]
    const model = modelOnly(command) ?? (record(command) && typeof command.template === "string" ? undefined : modelOnly(legacy[name]))
    return model ? [[name, model]] : []
  }))
}

/** Apply scoped model-only entries to the winning discovered definitions, without copying their templates. */
export function commandDocuments(entries: readonly Config.Entry[], documents: { commands: Config.Info["commands"] }[]) {
  const models = new Map(
    entries.flatMap((entry) =>
      entry.type === "document" && entry.info instanceof Info ? Object.entries(entry.info.workflow_models ?? {}) : [],
    ),
  )
  if (!models.size) return documents
  const commands = new Map(documents.flatMap((document) => Object.entries(document.commands ?? {})))
  const overrides = Object.fromEntries(
    [...models].flatMap(([name, model]) => {
      const command = commands.get(name)
      return command ? [[name, ConfigCommand.Info.make({ ...command, model })]] : []
    }),
  )
  if (!Object.keys(overrides).length) return documents
  return [...documents, { commands: overrides }]
}

/** Read only effective location config entries, never plugin storage or a user's ordinary config store. */
export function fromEntries(entries: readonly Config.Entry[]) {
  return {
    hide_prompt_training_models: entries.reduce(
      (value, entry) =>
        entry.type === "document" && entry.info instanceof Info && entry.info.hide_prompt_training_models !== undefined
          ? entry.info.hide_prompt_training_models
          : value,
      false,
    ),
  }
}

/**
 * Privacy mode of the effective entries: on when any document sets `privacy_mode: true`. A nearer `false` does not
 * turn off a `true` elsewhere (a global `true` stays on under a project `false`), so disabling clears every `true`.
 */
export function privacyMode(entries: readonly Config.Entry[]) {
  return entries.some((entry) => entry.type === "document" && entry.info instanceof Info && entry.info.privacy_mode === true)
}

/** The custom commit message prompt of the effective entries: the last document that sets one wins, and empty means none. */
export function commitMessagePrompt(entries: readonly Config.Entry[]) {
  const prompt = entries.reduce<string | undefined>(
    (value, entry) =>
      entry.type === "document" && entry.info instanceof Info && entry.info.commit_message?.prompt !== undefined
        ? entry.info.commit_message.prompt
        : value,
    undefined,
  )
  return prompt || undefined
}

/** The `indexing` key of the effective entries: later documents win, and nested provider options merge. */
export function indexingConfig(entries: readonly Config.Entry[]) {
  return entries.reduce<KiloIndexingRpc.Config | undefined>((value, entry) => {
    if (entry.type !== "document" || !(entry.info instanceof Info) || !entry.info.indexing) return value
    const next = entry.info.indexing
    if (!value) return next
    return Object.fromEntries(
      [...new Set([...Object.keys(value), ...Object.keys(next)])].map((key) => {
        const left = value[key as keyof KiloIndexingRpc.Config]
        const right = next[key as keyof KiloIndexingRpc.Config]
        if (right === undefined) return [key, left]
        if (record(left) && record(right)) return [key, { ...left, ...right }]
        return [key, right]
      }),
    ) as KiloIndexingRpc.Config
  }, undefined)
}

export const get = (config: Interface) => config.entries().pipe(Effect.map(fromEntries))
