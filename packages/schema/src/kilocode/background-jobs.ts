export * as KiloBackgroundJobsRpc from "./background-jobs.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.background-jobs` RPC contract: the subagent jobs one parent session started, with per-job stop and
// "continue in background". The background-jobs plugin in packages/kilo-plugin registers the handlers; clients import
// this contract from `@opencode/schema/kilocode/background-jobs`.
const portable = Schema.toStandardSchemaV1

export const Status = Schema.Literals(["running", "completed", "error", "cancelled"])
export type Status = typeof Status.Type

/** One subagent job. The job ID is the child session ID. */
export const Job = Schema.Struct({
  id: Schema.String,
  /** The session that started the subagent. */
  parentSessionID: SessionID,
  /** The child session the subagent runs in. */
  sessionID: SessionID,
  agent: optional(Schema.String),
  title: optional(Schema.String),
  status: Status,
  /** True once the job runs in the background: started with `background: true` or continued in the background. */
  background: Schema.Boolean,
  time: Schema.Struct({
    started: Schema.Number,
    completed: optional(Schema.Number),
  }),
  error: optional(Schema.String),
}).annotate({ identifier: "KiloBackgroundJob" })
export type Job = typeof Job.Type

export const Changed = Schema.Struct({
  parentSessionID: SessionID,
  job: Job,
}).annotate({ identifier: "KiloBackgroundJobChanged" })
export type Changed = typeof Changed.Type

const JobID = Schema.Struct({ jobID: Schema.String })

export const Definition = Rpc.define({
  id: "kilocode.background-jobs",
  methods: {
    /** The subagent jobs of one parent session, foreground and background, oldest first. */
    list: {
      input: portable(Schema.Struct({ sessionID: SessionID })),
      output: portable(Schema.Struct({ jobs: Schema.Array(Job) })),
    },
    /** Stop one subagent job, its child session and every session the child started. */
    cancel: {
      input: portable(JobID),
      output: portable(Schema.Boolean),
      errors: { not_found: portable(Schema.Undefined) },
    },
    /** Continue one running foreground subagent in the background; the parent's tool call returns at once. */
    promote: {
      input: portable(JobID),
      output: portable(Schema.Boolean),
      errors: { not_found: portable(Schema.Undefined) },
    },
  },
  events: {
    changed: { schema: portable(Changed) },
  },
})
