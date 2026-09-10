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
 * Native v2 `Config.Info` fields with a verified consumer at this baseline, plus
 * `hide_prompt_training_models`: a Kilo-only key the host config decode drops,
 * read raw by this store and consumed by the Kilo model picker presentation.
 * Collections (agents, permissions, mcp, providers, commands, formatter, lsp,
 * references, instructions, skills, plugins, watcher) are intentionally absent:
 * they accumulate or merge across documents, and some carry secrets. The
 * media.image and experimental leaves below apply per defined leaf across
 * documents in order (the host resolves each leaf last-wins), so they are
 * managed leaf-wise like compaction.
 */
export const SETTINGS_FIELD_KEYS = [
  "model",
  "default_agent",
  "shell",
  "snapshots",
  "websearch",
  "warming",
  "compaction.auto",
  "compaction.buffer",
  "compaction.keep.tokens",
  "tool_output.max_lines",
  "tool_output.max_bytes",
  "media.image.auto_resize",
  "media.image.max_width",
  "media.image.max_height",
  "media.image.max_base64_bytes",
  "experimental.subagent_depth",
  "experimental.portable_shell_scanner",
  "hide_prompt_training_models",
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

/** Optimistic edit token: null means the target did not exist when read. */
export const SettingsExpected = Schema.Struct({ path: Schema.String, revision: Schema.NullOr(Schema.String) })
export type SettingsExpected = typeof SettingsExpected.Type

/** Stored configuration values travel as JSON, exactly as written to the document. */
export const SettingsValue = Schema.Json
export type SettingsValue = typeof SettingsValue.Type

export const SettingsScopeState = Schema.Struct({
  scope: Scope,
  /** Resolved target file, including the path a first write would create. */
  path: Schema.String,
  exists: Schema.Boolean,
  writable: Schema.Boolean,
  expected: Schema.optional(SettingsExpected),
  /** Present only when the scope cannot be written; never carries file content. */
  reason: Schema.optional(Schema.String),
})
export type SettingsScopeState = typeof SettingsScopeState.Type

export const SettingsFieldState = Schema.Struct({
  key: FieldKey,
  title: Schema.String,
  description: Schema.String,
  kind: Kind,
  /** Integer input bound; omitted preserves the positive-integer default. */
  minimum: Schema.optional(Schema.Finite),
  /** Offered values for `choice` fields, in presentation order. */
  options: Schema.optional(Schema.Array(Schema.Struct({ title: Schema.String, value: SettingsValue }))),
  /** Raw stored values per scope, omitted where the scope does not define the field. */
  values: Schema.Struct({
    profile: Schema.optional(SettingsValue),
    project: Schema.optional(SettingsValue),
  }),
  /** Which loaded scope currently supplies the value. */
  source: Origin,
  /**
   * Fixed explanation when a scope stores a value that does not decode. The
   * arbitrary stored value is never carried; this text is a constant.
   */
  invalid: Schema.optional(Schema.String),
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

/**
 * Effective `hide_prompt_training_models` from a snapshot: project wins over profile,
 * exactly like the dialog's displayed source. Invalid stored values are already excluded
 * from `values` and reported through `invalid`, so they resolve as unset here — the
 * presentation filter and the Gateway request policy share this one resolution.
 */
export function hidePromptTrainingModels(snapshot: SettingsSnapshot) {
  const field = snapshot.fields.find((item) => item.key === "hide_prompt_training_models")
  return (field?.values.project ?? field?.values.profile) === true
}

const readInput = Schema.toStandardSchemaV1(Schema.Struct({}))
const setInput = Schema.toStandardSchemaV1(
  Schema.Struct({ scope: Scope, key: FieldKey, value: SettingsValue, expected: Schema.optional(SettingsExpected) }),
)
const resetInput = Schema.toStandardSchemaV1(
  Schema.Struct({ scope: Scope, key: FieldKey, expected: Schema.optional(SettingsExpected) }),
)
const rpcErrors = { "kilocode.settings": Schema.toStandardSchemaV1(Schema.Undefined) }

/**
 * Collection config writes for the original VS Code surface, over the actual
 * native `Config.Info` field names: `provider` and `agents` are record
 * collections (entry key required), `permissions` and the generated provider
 * policy list ride whole-array values. Closed set — MCP runs on its own native
 * API, file-based surfaces (skills) never ride config, and provider
 * enable/disable semantics ride the generated `policies` ruleset.
 */
export const SettingsCollection = Schema.Literals(["providers", "agents", "permissions", "policies"])
export type SettingsCollection = typeof SettingsCollection.Type

export const SettingsDiagnostic = Schema.Struct({
  source: Schema.String,
  kind: Schema.Literals(["conflict", "invalid", "unsupported"]),
  path: Schema.String,
  message: Schema.String,
})
export type SettingsDiagnostic = typeof SettingsDiagnostic.Type

export type SettingsCollectionEntry = {
  readonly value: unknown
  readonly source: "profile" | "project"
  readonly inherited: boolean
  readonly overridden: boolean
  readonly editable: boolean
  readonly reason?: string
}

export const SettingsCollectionSnapshot = Schema.Struct({
  scopes: Schema.Array(SettingsScopeState),
  entries: Schema.Record(Schema.String, Schema.Unknown),
  provenance: Schema.Record(
    Schema.String,
    Schema.Struct({
      source: Scope,
      inherited: Schema.Boolean,
      overridden: Schema.Boolean,
      editable: Schema.Boolean,
      reason: Schema.optional(Schema.String),
    }),
  ),
  diagnostics: Schema.Array(SettingsDiagnostic),
})
export type SettingsCollectionSnapshot = typeof SettingsCollectionSnapshot.Type

export const SettingsCollectionChange = Schema.Struct({
  scope: Scope,
  collection: SettingsCollection,
  key: Schema.String,
  path: Schema.String,
  changed: Schema.Boolean,
  snapshot: SettingsSnapshot,
})
export type SettingsCollectionChange = typeof SettingsCollectionChange.Type

const collectionGetInput = Schema.toStandardSchemaV1(
  Schema.Struct({ collection: SettingsCollection, scope: Scope }),
)
const collectionWriteInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    collection: SettingsCollection,
    key: Schema.optional(Schema.String),
    value: SettingsValue,
    scope: Scope,
    expected: Schema.optional(SettingsExpected),
  }),
)
const collectionUnsetInput = Schema.toStandardSchemaV1(
  Schema.Struct({
    collection: SettingsCollection,
    key: Schema.optional(Schema.String),
    scope: Scope,
    expected: Schema.optional(SettingsExpected),
  }),
)
const warningsOutput = Schema.toStandardSchemaV1(Schema.Array(SettingsDiagnostic))

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
      collectionGet: {
        input: collectionGetInput,
        output: Schema.toStandardSchemaV1(SettingsCollectionSnapshot),
        errors: rpcErrors,
      },
      collectionSet: {
        input: collectionWriteInput,
        output: Schema.toStandardSchemaV1(SettingsCollectionChange),
        errors: rpcErrors,
      },
      collectionUnset: {
        input: collectionUnsetInput,
        output: Schema.toStandardSchemaV1(SettingsCollectionChange),
        errors: rpcErrors,
      },
      warnings: { input: readInput, output: warningsOutput, errors: rpcErrors },
      refresh: { input: readInput, output: Schema.toStandardSchemaV1(Schema.Boolean), errors: rpcErrors },
    },
    events: {},
  })
}
