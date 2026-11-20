export * as KiloPermissionsRpc from "./permissions.js"

import { Schema } from "effect"
import { Project } from "../project.js"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.permissions` RPC contract: the project permission set offer. The permissions plugin in
// packages/kilo-plugin owns the applied sets and allows matching shell requests through the permission evaluate hook;
// applied sets are not saved permission grants.
const portable = Schema.toStandardSchemaV1

export const PresetID = Schema.Literals([
  "kilo-bun-checks",
  "kilo-bun-install",
  "typescript-checks",
  "typescript-install",
]).annotate({ identifier: "KiloPermissions.PresetID" })
export type PresetID = typeof PresetID.Type

export interface Preset extends Schema.Schema.Type<typeof Preset> {}
export const Preset = Schema.Struct({
  id: PresetID,
  resources: Schema.Array(Schema.String),
}).annotate({ identifier: "KiloPermissions.Preset" })

export const Decision = Schema.NullOr(Schema.Literals(["accepted", "skipped"])).annotate({
  identifier: "KiloPermissions.Decision",
})
export type Decision = typeof Decision.Type

export interface ListOutput extends Schema.Schema.Type<typeof ListOutput> {}
export const ListOutput = Schema.Struct({
  enabled: Schema.Boolean,
  projectID: Project.ID,
  decision: Decision,
  /** Sets that match the project now. */
  presets: Schema.Array(Preset),
  /** Sets applied to the project, with the shell rules the user approved when applying each one. */
  applied: Schema.Array(Preset),
}).annotate({ identifier: "KiloPermissions.ListOutput" })

export interface CheckResult extends Schema.Schema.Type<typeof CheckResult> {}
export const CheckResult = Schema.Struct({
  command: Schema.String,
  /** The command parts the set does not allow; empty when the whole command is allowed. */
  missing: Schema.Array(Schema.String),
}).annotate({ identifier: "KiloPermissions.CheckResult" })

export interface CheckOutput extends Schema.Schema.Type<typeof CheckOutput> {}
export const CheckOutput = Schema.Struct({
  presetID: PresetID,
  results: Schema.Array(CheckResult),
}).annotate({ identifier: "KiloPermissions.CheckOutput" })

const Empty = Schema.Struct({})
const unavailable = { unavailable: portable(Schema.Undefined) }
const notApplicable = { not_applicable: portable(Schema.Undefined) }

export const Definition = Rpc.define({
  id: "kilocode.permissions",
  methods: {
    list: {
      input: portable(Empty),
      output: portable(ListOutput),
    },
    apply: {
      input: portable(Schema.Struct({ presetID: PresetID })),
      output: portable(Empty),
      errors: { ...unavailable, ...notApplicable },
    },
    skip: {
      input: portable(Empty),
      output: portable(Empty),
      errors: unavailable,
    },
    /**
     * The user's choice of no set: removes the applied sets and records the offer as skipped, so it is not offered
     * again. Gated by the flag like `apply` and `skip`.
     */
    clear: {
      input: portable(Empty),
      output: portable(Empty),
      errors: unavailable,
    },
    /**
     * Testing reset, always available: clears the offer decision so it is offered again; `all` also removes the
     * applied sets. Saved permission grants are never touched.
     */
    reset: {
      input: portable(Schema.Struct({ all: optional(Schema.Boolean) })),
      output: portable(Schema.Struct({ removed: Schema.Number })),
    },
    /** Reports which shell commands a set does not allow, as the plugin would evaluate them. */
    check: {
      input: portable(Schema.Struct({ presetID: optional(PresetID), commands: Schema.Array(Schema.String) })),
      output: portable(CheckOutput),
      errors: { ...unavailable, ...notApplicable },
    },
  },
  events: {
    /** The sets applied to the project changed. */
    updated: { schema: portable(Schema.Struct({ projectID: Project.ID, applied: Schema.Array(Preset) })) },
  },
})
