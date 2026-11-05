export * as KiloSandboxRpc from "./sandbox.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.sandbox` RPC contract: per-session sandbox confinement of agent tools (shell, filesystem writes,
// network). The sandbox plugin in packages/kilo-plugin registers the handlers; clients import this contract from
// `@opencode/schema/kilocode/sandbox`. The configured defaults (`sandbox` config key) stay in the config documents.
const portable = Schema.toStandardSchemaV1

/** Whether the operating system sandbox backend can run the configured network policy. */
export const Support = Schema.Struct({
  available: Schema.Boolean,
  reason: optional(Schema.String),
}).annotate({ identifier: "SandboxSupport" })
export type Support = typeof Support.Type

/** The effective sandbox state of one session. */
export const Status = Schema.Struct({
  directory: Schema.String,
  enabled: Schema.Boolean,
  available: Schema.Boolean,
  reason: optional(Schema.String),
  /** True when the session's network is restricted (deny or an allowed-host proxy). */
  network: Schema.Boolean,
  version: Schema.Int,
}).annotate({ identifier: "SandboxStatus" })
export type Status = typeof Status.Type

export const Changed = Schema.Struct({
  sessionID: SessionID,
  ...Status.fields,
}).annotate({ identifier: "SandboxChanged" })
export type Changed = typeof Changed.Type

const Session = Schema.Struct({ sessionID: SessionID })

export const Definition = Rpc.define({
  id: "kilocode.sandbox",
  methods: {
    /** Backend availability for the configured policy, without a session. */
    support: {
      input: portable(Schema.Struct({})),
      output: portable(Support),
    },
    status: {
      input: portable(Session),
      output: portable(Status),
      errors: { not_found: portable(Schema.Undefined) },
    },
    /** Toggle and persist the sandbox state of one session. Enabling fails while the session or a subagent runs. */
    toggle: {
      input: portable(Session),
      output: portable(Status),
      errors: { not_found: portable(Schema.Undefined), busy: portable(Schema.Undefined) },
    },
  },
  events: {
    changed: { schema: portable(Changed) },
  },
})
