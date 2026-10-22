export * as KiloMarketplaceRpc from "./marketplace.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.marketplace` RPC contract (U-E2-23): discover, install and remove marketplace items. The marketplace
// plugin in packages/kilo-plugin registers the handlers; clients (TUI, `kilo marketplace`, VS Code, JetBrains)
// import this contract from `@opencode/schema/kilocode/marketplace`.
//
// Items are normalized across registries: `registry` names the source (today only `kilo`), `kind` the item type.
// All file and config writes happen on the server, so a client of a remote server installs on that server.
const portable = Schema.toStandardSchemaV1
const Failure = {
  fetch_failed: portable(Schema.Undefined),
  not_found: portable(Schema.Undefined),
  conflict: portable(Schema.Undefined),
  invalid_params: portable(Schema.Undefined),
  write_failed: portable(Schema.Undefined),
  unsupported: portable(Schema.Undefined),
}

export const Kind = Schema.Literals(["skill", "mcp", "agent"])
export type Kind = typeof Kind.Type

/** `global` installs into the global config directory, `project` into the `.kilo2` directory of the project. */
export const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

export const Parameter = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  placeholder: optional(Schema.String),
  optional: Schema.Boolean,
})
export type Parameter = typeof Parameter.Type

/** One way to install an item, for example the NPX or Docker variant of an MCP server. */
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

/** Content evidence for a managed resource. During recovery both the previous and planned contents may be owned. */
export const Resource = Schema.Union([
  Schema.Struct({ path: Schema.String, fingerprints: optional(Schema.Array(Schema.String)) }),
  Schema.Struct({ config: Schema.String, server: Schema.String, fingerprints: optional(Schema.Array(Schema.String)) }),
])
export type Resource = typeof Resource.Type

/** A marketplace install recorded by the plugin, so that uninstall removes exactly what install wrote. */
export const Installed = Schema.Struct({
  registry: Schema.String,
  kind: Kind,
  id: Schema.String,
  scope: Scope,
  /** The project directory of a `project` install. */
  project: optional(Schema.String),
  /** Directories the install created (the skill directory and companion skills). */
  paths: Schema.Array(Schema.String),
  /** The config file that holds the `mcp.servers.<id>` entry of an MCP install. */
  config: optional(Schema.String),
  /** The `mcp.servers` key of an MCP install, which clients need for status and sign-in. */
  server: optional(Schema.String),
  /** Fingerprints authorize destructive operations, not just the resource's path or server name. */
  resources: optional(Schema.Array(Resource)),
  /** An intent persisted before mutations; a retry or uninstall can recover an interrupted installation. */
  recovering: optional(Schema.Boolean),
  /** Reconciled with the filesystem when installations are listed. */
  status: optional(Schema.Literals(["ready", "missing", "modified", "incomplete"])),
  warnings: optional(Schema.Array(Schema.String)),
  /** Obsolete resources still owned until cleanup succeeds, including across reinstalls. */
  pending: optional(Schema.Array(Resource)),
  installedAt: Schema.Number,
})
export type Installed = typeof Installed.Type

/** A marketplace source. Only enabled registries take part in `list` and `install`. */
export const RegistryInfo = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
  kinds: Schema.Array(Kind),
  /** Hand-reviewed by Kilo. Other registries list community content that nobody at Kilo reviewed. */
  curated: Schema.Boolean,
  /** Lists only what matches a query, or a top slice when there is none (large catalogs). */
  searchable: Schema.Boolean,
  enabled: Schema.Boolean,
})
export type RegistryInfo = typeof RegistryInfo.Type

const Ref = { registry: Schema.String, kind: Kind, id: Schema.String }

export const Definition = Rpc.define({
  id: "kilocode.marketplace",
  methods: {
    list: {
      input: portable(
        Schema.Struct({
          kind: Kind,
          refresh: optional(Schema.Boolean),
          /** Search text. Searchable registries search their whole catalog; the others filter their list. */
          query: optional(Schema.String),
        }),
      ),
      /** `failures` names the registries that could not be loaded; the items of the others are still returned. */
      output: portable(
        Schema.Struct({
          items: Schema.Array(Item),
          failures: Schema.Array(Schema.Struct({ registry: Schema.String, message: Schema.String })),
        }),
      ),
      errors: Failure,
    },
    registries: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(RegistryInfo)),
      errors: Failure,
    },
    "registries.set": {
      input: portable(Schema.Struct({ id: Schema.String, enabled: Schema.Boolean })),
      output: portable(Schema.Array(RegistryInfo)),
      errors: Failure,
    },
    installed: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Installed)),
      errors: Failure,
    },
    install: {
      input: portable(
        Schema.Struct({
          ...Ref,
          scope: Scope,
          /** The `name` of an install option. Defaults to the first option. */
          option: optional(Schema.String),
          /** Values for the item's and the option's parameters, by `key`. */
          params: optional(Schema.Record(Schema.String, Schema.String)),
        }),
      ),
      output: portable(Installed),
      errors: Failure,
    },
    uninstall: {
      input: portable(Schema.Struct({ ...Ref, scope: Scope })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {},
})
