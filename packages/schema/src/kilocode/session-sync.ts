export * as KiloSessionSyncRpc from "./session-sync.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

const portable = Schema.toStandardSchemaV1

export const Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "KiloSessionSync.Failure" })
export interface Failure extends Schema.Schema.Type<typeof Failure> {}

export const Status = Schema.Struct({
  directory: Schema.String,
  enabled: Schema.Boolean,
  destination: optional(Schema.String),
  tenant: optional(Schema.Struct({ type: Schema.Literals(["user", "organization"]), id: Schema.String })),
  userID: optional(Schema.String),
  sourceID: optional(Schema.String),
  pending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  sessions: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  lastSuccess: optional(Schema.Number),
  error: optional(Failure),
}).annotate({ identifier: "KiloSessionSync.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const PullResult = Schema.Struct({
  sessionID: Schema.String,
  directory: Schema.String,
  outcome: Schema.Literals(["imported", "updated", "restored", "unchanged", "as-new"]),
  message: Schema.String,
  position: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  messages: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
}).annotate({ identifier: "KiloSessionSync.PullResult" })
export interface PullResult extends Schema.Schema.Type<typeof PullResult> {}

export const DeleteResult = Schema.Struct({
  sessionID: Schema.String,
  deleted: Schema.Boolean,
  message: Schema.String,
}).annotate({ identifier: "KiloSessionSync.DeleteResult" })
export interface DeleteResult extends Schema.Schema.Type<typeof DeleteResult> {}

const Workspace = Schema.Struct({ directory: Schema.String })
const errors = { failed: portable(Failure) }

export const Definition = Rpc.define({
  id: "kilocode.session-sync",
  methods: {
    enable: {
      input: portable(
        Schema.Struct({
          directory: Schema.String,
          organizationID: Schema.NullOr(Schema.String),
          assets: optional(Schema.Array(Schema.String)),
        }),
      ),
      output: portable(Status),
      errors,
    },
    disable: { input: portable(Workspace), output: portable(Status), errors },
    status: { input: portable(Workspace), output: portable(Status), errors },
    flush: { input: portable(Workspace), output: portable(Status), errors },
    pull: {
      input: portable(
        Schema.Struct({
          directory: Schema.String,
          sessionID: Schema.String,
          replaceLocal: optional(Schema.Boolean),
          asNew: optional(Schema.Boolean),
        }),
      ),
      output: portable(PullResult),
      errors,
    },
    deleteSession: {
      input: portable(Schema.Struct({ directory: Schema.String, sessionID: Schema.String })),
      output: portable(DeleteResult),
      errors,
    },
    synced: {
      input: portable(Schema.Struct({ directory: Schema.String, sessionID: Schema.String })),
      output: portable(Schema.Struct({ sessionID: Schema.String, synced: Schema.Boolean })),
      errors,
    },
  },
  events: {},
})
