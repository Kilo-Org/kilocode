export * as KiloConfigPolicy from "./policy.js"

import { Config } from "@opencode/schema/config"
import { ConfigCommand } from "@opencode/schema/config/command"
import { ConfigModel } from "@opencode/schema/config/model"
import { optional } from "@opencode/schema/schema"
import { Effect, Option, Schema } from "effect"
import type { Interface } from "../../config.js"
import type { ConfigNormalize } from "../../config/normalize.js"

export class Info extends Config.Info.extend<Info>("KiloConfigPolicy.Info")({
  hide_prompt_training_models: Schema.Boolean.pipe(optional).annotate({
    description: "Hide Kilo models that can use prompts for training and deny provider data collection",
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
  // kilo_port(unattributed:core/v1:fb80dc4c3dd4)
  commit_message: Schema.Struct({
    prompt: Schema.String.pipe(optional).annotate({
      description:
        "Custom system prompt for AI commit message generation. When set, replaces the default conventional commits prompt entirely.",
    }),
  })
    .pipe(optional)
    .annotate({ description: "Configuration for AI-generated commit messages" }),
}) {}

const decode = Schema.decodeUnknownOption(Info, { errors: "all", onExcessProperty: "ignore" })
const policy = Schema.Struct({ hide_prompt_training_models: Schema.optional(Schema.Boolean) })
const commit = Schema.Struct({ commit_message: Schema.optional(Schema.Struct({ prompt: Schema.optional(Schema.String) })) })
const decodeModel = Schema.decodeUnknownOption(ConfigModel.Selection)

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
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
  const message = Schema.decodeUnknownOption(commit)(input)
  if (Option.isNone(message))
    report?.({
      path: ["commit_message"],
      kind: "invalid",
      message: "ignored invalid commit_message; expected an object with an optional string prompt",
    })
  const models = input instanceof Info ? input.workflow_models : record(input) ? workflowModels(input) : undefined
  // Managed policy splitting clears optional fields with undefined; the encoded schema requires omitted keys.
  return Option.getOrUndefined(
    decode(
      Object.fromEntries(
        Object.entries({
          ...normalized,
          ...raw,
          ...Option.getOrElse(message, () => ({})),
          ...displaySettings(input),
          workflow_models: models && Object.keys(models).length ? models : undefined,
        }).filter(([, value]) => value !== undefined),
      ),
    ),
  )
}

/** The display layouts, ignoring an invalid value instead of failing the whole document. */
function displaySettings(input: unknown) {
  if (!record(input)) return {}
  const decodeLayout = Schema.decodeUnknownOption(Schema.Literals(["expanded", "collapsed"]))
  return Object.fromEntries(
    ["terminal_command_display", "code_edit_display", "mcp_tool_display"].flatMap((key) => {
      const value = Option.getOrUndefined(decodeLayout(input[key]))
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

export const get = (config: Interface) => config.entries().pipe(Effect.map(fromEntries))
