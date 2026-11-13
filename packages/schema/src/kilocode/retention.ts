export * as KiloRetentionRpc from "./retention.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.retention` RPC contract: machine-wide deletion of expired sessions. The retention plugin in
// packages/kilo-plugin owns the policy (`retention.enabled`, `retention.maxAgeDays` in config), the spacing between
// passes, which sessions are expired and which are busy. Clients only trigger a pass and show its state; they import
// this contract from `@opencode/schema/kilocode/retention`.
const portable = Schema.toStandardSchemaV1

const Count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

/** The effective policy. Nothing is deleted unless `enabled` is true. */
export const Policy = Schema.Struct({
  enabled: Schema.Boolean,
  maxAgeDays: Schema.Number,
}).annotate({ identifier: "KiloRetentionPolicy" })
export type Policy = typeof Policy.Type

/** The outcome of the last pass that ran, kept across restarts. */
export const Result = Schema.Struct({
  /** Start of the pass, in epoch milliseconds. */
  at: Schema.Number,
  scanned: Count,
  deleted: Count,
  skippedActive: Count,
  failed: Count,
  durationMs: Schema.Number,
  /** Set when a cancel stopped the pass before it removed every expired session. */
  cancelled: optional(Schema.Boolean),
  reclaimedBytes: optional(Schema.Number),
}).annotate({ identifier: "KiloRetentionResult" })
export type Result = typeof Result.Type

export const Phase = Schema.Literals(["scanning", "deleting", "cancelling"]).annotate({
  identifier: "KiloRetentionPhase",
})
export type Phase = typeof Phase.Type

/** The pass in flight. `processed` is `deleted + failed`, out of `total` expired sessions. */
export const Progress = Schema.Struct({
  phase: Phase,
  total: Count,
  processed: Count,
  deleted: Count,
  failed: Count,
  skippedActive: Count,
}).annotate({ identifier: "KiloRetentionProgress" })
export type Progress = typeof Progress.Type

export const Status = Schema.Struct({
  policy: Policy,
  last: optional(Result),
  progress: optional(Progress),
}).annotate({ identifier: "KiloRetentionStatus" })
export type Status = typeof Status.Type

export const Definition = Rpc.define({
  id: "kilocode.retention",
  methods: {
    /** The policy, the last pass and the pass in flight, if any. */
    status: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
    /**
     * Run one pass and return when it ends. Does nothing unless the policy is enabled; `force` skips the minimum
     * spacing between passes, never the enable check. A call while a pass is in flight joins that pass instead of
     * starting another one.
     */
    run: {
      input: portable(Schema.Struct({ force: optional(Schema.Boolean) })),
      output: portable(Status),
    },
    /**
     * Stop the pass in flight before it removes more sessions. Removed sessions stay removed and the pass records its
     * partial result. `requested` is false when no pass runs or its removals already ended.
     */
    cancel: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ requested: Schema.Boolean })),
    },
  },
  events: {},
})
