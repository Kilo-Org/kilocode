export * as KiloGoalRpc from "./goal.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.goal` RPC contract: the session Goal that a client shows and controls. The goal plugin in
// packages/kilo-plugin registers the handlers; clients (TUI, VS Code, JetBrains) import this contract from
// `@opencode/schema/kilocode/goal`, never from Core or the plugin. Standard Schemas, so the promise client of
// the TUI accepts the contract too.
const portable = Schema.toStandardSchemaV1

export const Status = Schema.Literals(["active", "complete", "blocked", "paused", "waiting"])

export type Status = typeof Status.Type

export const Wait = Schema.Struct({
  kind: Schema.Literals(["wakeup", "cron", "process"]),
  id: Schema.String,
  label: Schema.String,
  dueAt: optional(Schema.Number),
  recurring: optional(Schema.Boolean),
})

export type Wait = typeof Wait.Type

export const State = Schema.Struct({
  /** Stable identity of this goal, so a late continuation cannot rewrite a newer goal. */
  id: Schema.String,
  text: Schema.String,
  status: Status,
  /** Why the goal last changed: the model's report, or what paused it. */
  reason: optional(Schema.String),
  /** What the goal suspends on while its status is waiting. */
  wait: optional(Wait),
  updatedAt: Schema.Number,
}).annotate({ identifier: "KiloGoal.State" })

export type State = typeof State.Type

// The handlers live in the goal plugin. `get` returns null when the session has no goal; `changed` carries every
// write, including a removal as `null`, so a client never has to poll.
export const Definition = Rpc.define({
  id: "kilocode.goal",
  methods: {
    get: {
      input: portable(Schema.Struct({ sessionID: Schema.String })),
      output: portable(Schema.NullOr(State)),
    },
  },
  events: {
    changed: {
      schema: portable(Schema.Struct({ sessionID: Schema.String, goal: Schema.NullOr(State) })),
    },
  },
})