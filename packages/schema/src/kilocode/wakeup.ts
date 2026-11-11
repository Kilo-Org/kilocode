export * as KiloWakeupRpc from "./wakeup.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.wakeup` RPC contract: the wakeups and cron tasks a session holds, and the per-session pending state
// clients show as `scheduled`. The wakeup plugin in packages/kilo-plugin registers the handlers and publishes
// `changed`; clients import this contract from `@opencode/schema/kilocode/wakeup`, never from Core or the plugin.
// Standard Schemas, so the promise client of the TUI accepts the contract too.
const portable = Schema.toStandardSchemaV1

export const Kind = Schema.Literals(["wakeup", "cron"]).annotate({ identifier: "KiloWakeupKind" })
export type Kind = typeof Kind.Type

/** One pending wakeup or cron task. The id is the one the scheduling tools report. */
export const Wakeup = Schema.Struct({
  id: Schema.String,
  sessionID: SessionID,
  kind: Kind,
  prompt: Schema.String,
  reason: optional(Schema.String),
  /** The next fire time, when the task is still active. */
  dueAt: optional(Schema.Number),
  recurring: Schema.Boolean,
  /** The 5-field cron expression of a recurring task. */
  schedule: optional(Schema.String),
}).annotate({ identifier: "KiloWakeup" })
export type Wakeup = typeof Wakeup.Type

/** How many wakeups a session holds, and the earliest future due time, so clients can show `scheduled`. */
export const Pending = Schema.Struct({
  sessionID: SessionID,
  directory: Schema.String,
  pending: Schema.Number,
  dueAt: optional(Schema.Number),
}).annotate({ identifier: "KiloWakeupPending" })
export type Pending = typeof Pending.Type

/** Every write publishes the session's new pending state; a session at zero has no future wakeup. */
export const Changed = Pending
export type Changed = typeof Changed.Type

export const Definition = Rpc.define({
  id: "kilocode.wakeup",
  methods: {
    /** The wakeups and cron tasks one session holds, wakeups first, then by due time. */
    list: {
      input: portable(Schema.Struct({ sessionID: SessionID })),
      output: portable(Schema.Struct({ wakeups: Schema.Array(Wakeup) })),
    },
    /** The pending wakeups of every session in one directory. */
    pending: {
      input: portable(Schema.Struct({ directory: Schema.String })),
      output: portable(Schema.Struct({ sessions: Schema.Array(Pending) })),
    },
  },
  events: {
    changed: { schema: portable(Changed) },
  },
})
