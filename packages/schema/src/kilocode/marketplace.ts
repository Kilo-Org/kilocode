export * as KiloMarketplaceRpc from "./marketplace.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The plugin owns all file/config writes, including when clients connect to a remote server.
const portable = Schema.toStandardSchemaV1
const Failure = {
  fetch_failed: portable(Schema.Undefined),
  not_found: portable(Schema.Undefined),
  conflict: portable(Schema.Undefined),
  invalid_params: portable(Schema.Undefined),
  write_failed: portable(Schema.Undefined),
  unsupported: portable(Schema.Undefined),
}

export const Kind = Schema.Literals(["skill", "mcp"])
export type Kind = typeof Kind.Type

/** Install into the global config directory or the opened project. */
export const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

export const Parameter = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  placeholder: optional(Schema.String),
  optional: Schema.Boolean,
  /** Mask entry in clients; supplied values can still be stored as plaintext in MCP config. */
  secret: optional(Schema.Boolean),
})
export type Parameter = typeof Parameter.Type

export const InstallOption = Schema.Struct({
  name: Schema.String,
  description: optional(Schema.String),
  prerequisites: Schema.Array(Schema.String),
  parameters: Schema.Array(Parameter),
})
export type InstallOption = typeof InstallOption.Type

export const Item = Schema.Struct({
  registry: Schema.String,
  kind: Kind,
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  category: optional(Schema.String),
  author: optional(Schema.String),
  url: optional(Schema.String),
  tags: Schema.Array(Schema.String),
  prerequisites: Schema.Array(Schema.String),
  /** Parameters shared by every install option. */
  parameters: Schema.Array(Parameter),
  options: Schema.Array(InstallOption),
})
export type Item = typeof Item.Type

/**
 * Owned resources are located from the current scope, never from stored paths: a skill tree is
 * `<skills root>/<id>` and an MCP entry is found by server name in the scope's native config files.
 * During recovery both previous and planned contents may be owned.
 */
export const Resource = Schema.Union([
  Schema.Struct({ id: Schema.String, fingerprints: optional(Schema.Array(Schema.String)) }),
  Schema.Struct({ server: Schema.String, fingerprints: optional(Schema.Array(Schema.String)) }),
])
export type Resource = typeof Resource.Type

/** A managed installation, authorizing removal of exactly the resources it wrote. */
export const Installed = Schema.Struct({
  /** Stored record format; an unknown version is skipped instead of being misread. */
  version: optional(Schema.Literal(1)),
  registry: Schema.String,
  kind: Kind,
  id: Schema.String,
  scope: Scope,
  project: optional(Schema.String),
  /** MCP config file relative to the scope root, so records survive moving the project. */
  config: optional(Schema.String),
  /** Native mcp.servers key, used for status and sign-in handoff. */
  server: optional(Schema.String),
  resources: optional(Schema.Array(Resource)),
  /** Intent persisted before mutations, recoverable by retry or uninstall. */
  recovering: optional(Schema.Boolean),
  status: optional(Schema.Literals(["ready", "missing", "modified", "incomplete"])),
  warnings: optional(Schema.Array(Schema.String)),
  /** Obsolete resources remain owned until cleanup succeeds. */
  pending: optional(Schema.Array(Resource)),
  installedAt: Schema.Number,
})
export type Installed = typeof Installed.Type

const Ref = { registry: Schema.String, kind: Kind, id: Schema.String }
const InstallInput = Schema.Struct({
  ...Ref,
  scope: Scope,
  option: optional(Schema.String),
  params: optional(Schema.Record(Schema.String, Schema.String)),
})

export const Definition = Rpc.define({
  id: "kilocode.marketplace",
  methods: {
    list: {
      input: portable(Schema.Struct({ kind: Kind, refresh: optional(Schema.Boolean), query: optional(Schema.String) })),
      output: portable(
        Schema.Struct({
          items: Schema.Array(Item),
          /** A failed refresh can return the persisted catalog with a warning. */
          failures: Schema.Array(Schema.Struct({ registry: Schema.String, message: Schema.String })),
        }),
      ),
      errors: Failure,
    },
    installed: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Installed)),
      errors: Failure,
    },
    /** Read-only preview; redact secrets before interpolating the template. */
    preview: {
      input: portable(InstallInput),
      output: portable(
        Schema.Struct({
          config: Schema.String,
          server: Schema.String,
          parameters: Schema.Array(Schema.String),
          /** Names of nonempty secret parameters that will be stored in plaintext. */
          secrets: Schema.Array(Schema.String),
        }),
      ),
      errors: Failure,
    },
    install: { input: portable(InstallInput), output: portable(Installed), errors: Failure },
    uninstall: {
      input: portable(Schema.Struct({ ...Ref, scope: Scope })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {},
})
