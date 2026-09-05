import { Rpc } from "@opencode-ai/schema/rpc"
import { Schema } from "effect"

/**
 * Public contract for Kilo settings management. This module is the only part of
 * the feature the TUI imports: it carries no filesystem, Core, or Server code.
 *
 * Scopes are named for what the v2 host actually loads. The Kilo host runs
 * `Config.configured({ global: false })` and passes the profile config file as
 * the explicit config source, so there is no "global" scope; project documents
 * are opt-in and absent unless the host enabled them.
 */
export const SETTINGS_SCOPES = ["profile", "project"] as const

/**
 * Only native v2 `Config.Info` fields with a verified consumer at this baseline.
 * Collections (agents, permissions, mcp, providers, commands, formatter, lsp,
 * references, instructions, skills, plugins, experimental) are intentionally
 * absent: they accumulate or merge across documents, and some carry secrets.
 */
export const SETTINGS_FIELD_KEYS = [
  "model",
  "default_agent",
  "shell",
  "snapshots",
  "websearch",
  "warming",
  "tool_output.max_lines",
  "tool_output.max_bytes",
] as const

/**
 * Reported to users instead of inventing a mapping for v1 settings v2 removed.
 * The authoritative per-key verdict for a real file comes from the upstream
 * migration engine through `kilo2 import-v1-config --report`.
 */
export const SETTINGS_UNSUPPORTED_NOTE =
  "This dialog edits native v2 fields. Kilo privacy uses /privacy; indexing uses an explicit --indexing-config file. Other v1-only fields are not shown. Run the v1 config import report for a per-key verdict on your own file."

const Scope = Schema.Literals(SETTINGS_SCOPES)
export type SettingsScope = typeof Scope.Type

const FieldKey = Schema.Literals(SETTINGS_FIELD_KEYS)
export type SettingsFieldKey = typeof FieldKey.Type

const Kind = Schema.Literals(["boolean", "string", "integer", "choice"])
export type SettingsFieldKind = typeof Kind.Type

const Origin = Schema.Literals(["profile", "project", "unset"])

/** Stored configuration values travel as JSON, exactly as written to the document. */
export const SettingsValue = Schema.Json
export type SettingsValue = typeof SettingsValue.Type

export const SettingsScopeState = Schema.Struct({
  scope: Scope,
  /** Resolved target file, including the path a first write would create. */
  path: Schema.String,
  exists: Schema.Boolean,
  writable: Schema.Boolean,
  /** Present only when the scope cannot be written; never carries file content. */
  reason: Schema.optional(Schema.String),
})
export type SettingsScopeState = typeof SettingsScopeState.Type

export const SettingsFieldState = Schema.Struct({
  key: FieldKey,
  title: Schema.String,
  description: Schema.String,
  kind: Kind,
  /** Offered values for `choice` fields, in presentation order. */
  options: Schema.optional(Schema.Array(Schema.Struct({ title: Schema.String, value: SettingsValue }))),
  /** Raw stored values per scope, omitted where the scope does not define the field. */
  values: Schema.Struct({
    profile: Schema.optional(SettingsValue),
    project: Schema.optional(SettingsValue),
  }),
  /** Which loaded scope currently supplies the value. */
  source: Origin,
})
export type SettingsFieldState = typeof SettingsFieldState.Type

export const SettingsSnapshot = Schema.Struct({
  scopes: Schema.Array(SettingsScopeState),
  fields: Schema.Array(SettingsFieldState),
  /** True when loaded config changes only take effect after a host restart. */
  restartRequired: Schema.Boolean,
  note: Schema.String,
})
export type SettingsSnapshot = typeof SettingsSnapshot.Type

export const SettingsChange = Schema.Struct({
  scope: Scope,
  key: FieldKey,
  path: Schema.String,
  changed: Schema.Boolean,
  snapshot: SettingsSnapshot,
})
export type SettingsChange = typeof SettingsChange.Type

const readInput = Schema.toStandardSchemaV1(Schema.Struct({}))
const setInput = Schema.toStandardSchemaV1(Schema.Struct({ scope: Scope, key: FieldKey, value: SettingsValue }))
const resetInput = Schema.toStandardSchemaV1(Schema.Struct({ scope: Scope, key: FieldKey }))
const rpcErrors = { "kilocode.settings": Schema.toStandardSchemaV1(Schema.Undefined) }

/**
 * Read, set, and reset Kilo configuration in an explicit scope. Every operation
 * runs in the host Location and never admits a session item or calls a model.
 */
export namespace SettingsRpc {
  export const Definition = Rpc.define({
    id: "kilocode.settings",
    methods: {
      read: { input: readInput, output: Schema.toStandardSchemaV1(SettingsSnapshot), errors: rpcErrors },
      set: { input: setInput, output: Schema.toStandardSchemaV1(SettingsChange), errors: rpcErrors },
      reset: { input: resetInput, output: Schema.toStandardSchemaV1(SettingsChange), errors: rpcErrors },
    },
    events: {},
  })
}
