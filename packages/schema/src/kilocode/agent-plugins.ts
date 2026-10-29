export * as KiloAgentPluginsRpc from "./agent-plugins.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.agent-plugins` RPC contract: install, list, enable and disable Agent Plugins (agent-plugins.org).
// The Agent Plugins plugin in packages/kilo-plugin registers the handlers and owns every file and config write, also
// when a client connects to a remote server. Clients import this contract from `@opencode/schema/kilocode/agent-plugins`.
const portable = Schema.toStandardSchemaV1
const Failure = {
  not_found: portable(Schema.Undefined),
  invalid: portable(Schema.Undefined),
  conflict: portable(Schema.Undefined),
  fetch_failed: portable(Schema.Undefined),
  write_failed: portable(Schema.Undefined),
  unsupported: portable(Schema.Undefined),
}

/** The global config directory or the opened project's `.kilo2` directory. */
export const Scope = Schema.Literals(["global", "project"])
export type Scope = typeof Scope.Type

export const Diagnostic = Schema.Struct({
  severity: Schema.Literals(["error", "warning"]),
  code: Schema.String,
  message: Schema.String,
  component: optional(Schema.Literals(["skills", "mcp"])),
  /** The skill directory or MCP server name the problem belongs to. */
  item: optional(Schema.String),
})
export type Diagnostic = typeof Diagnostic.Type

export const Plugin = Schema.Struct({
  /** Absent when `plugin.json` could not be read. */
  name: optional(Schema.String),
  /** The resolved plugin root (`PLUGIN_ROOT`). */
  root: Schema.String,
  /** Where the plugin was found: a scope's `plugins/` directory, or an `agent_plugins.paths` entry. */
  scope: Schema.Literals(["global", "project", "explicit"]),
  /**
   * `loaded`: its skills and MCP servers are active. `rejected`: `plugin.json` is invalid. `disabled`: named in
   * `agent_plugins.disabled`. `shadowed`: a nearer plugin with the same name replaces it.
   */
  status: Schema.Literals(["loaded", "rejected", "disabled", "shadowed"]),
  version: optional(Schema.String),
  description: optional(Schema.String),
  author: optional(
    Schema.Struct({ name: optional(Schema.String), email: optional(Schema.String), url: optional(Schema.String) }),
  ),
  homepage: optional(Schema.String),
  repository: optional(Schema.String),
  license: optional(Schema.String),
  keywords: optional(Schema.Array(Schema.String)),
  /** Skill IDs (`<plugin>:<skill>`) as `skill.list` reports them. */
  skills: Schema.Array(Schema.String),
  /** `mcp.servers` names (`<plugin>:<server>`); join with `mcp.list` for status and the sign-in integration. */
  servers: Schema.Array(Schema.String),
  /** True when the plugin sits in a scope's `plugins/` directory, so `uninstall` can remove it. */
  removable: Schema.Boolean,
  diagnostics: Schema.Array(Diagnostic),
})
export type Plugin = typeof Plugin.Type

/** A plugin directory on the server's filesystem, or a tar or tar.gz archive URL (for example a GitHub archive). */
export const Source = Schema.Union([
  Schema.Struct({ type: Schema.Literal("path"), path: Schema.String }),
  Schema.Struct({
    type: Schema.Literal("archive"),
    url: Schema.String,
    /** The plugin root inside the archive, relative to its single top-level directory when it has one. */
    subdirectory: optional(Schema.String),
  }),
])
export type Source = typeof Source.Type

export const Definition = Rpc.define({
  id: "kilocode.agent-plugins",
  methods: {
    /** Every plugin found for the location, including rejected, disabled and shadowed ones. */
    list: { input: portable(Schema.Struct({})), output: portable(Schema.Array(Plugin)), errors: Failure },
    /**
     * Validates the plugin, then places it in the scope's `plugins/<name>` directory. An existing plugin with the
     * same name fails with `conflict` unless `replace` is set; its `PLUGIN_DATA` is kept either way.
     */
    install: {
      input: portable(Schema.Struct({ source: Source, scope: Scope, replace: optional(Schema.Boolean) })),
      output: portable(Plugin),
      errors: Failure,
    },
    /** Removes the plugin from the scope's `plugins/` directory; a linked plugin only loses its link. */
    uninstall: {
      input: portable(Schema.Struct({ name: Schema.String, scope: Scope, removeData: optional(Schema.Boolean) })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
    /**
     * Disabling adds the name to `agent_plugins.disabled` in the scope's config file. Enabling removes it from the
     * global and project config files, since a name disabled in either stays disabled.
     */
    setEnabled: {
      input: portable(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean, scope: Scope })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {
    /** The plugin list changed: an install, uninstall, setting change or file change was picked up. */
    changed: { schema: portable(Schema.Struct({})) },
  },
})
