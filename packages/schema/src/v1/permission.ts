export * as PermissionV1 from "./permission"

import { Schema } from "effect"
import { define, inventory } from "../event"
import { ascending } from "../identifier"
import { Project } from "../project"
import { NonNegativeInt, optional } from "../schema" // kilocode_change
import { statics } from "../schema"
import { SessionID } from "../session-id"

export const ID = Schema.String.check(Schema.isStartsWith("per")).pipe(
  Schema.brand("PermissionID"),
  statics((schema) => ({ ascending: (id?: string) => schema.make(id ?? "per_" + ascending()) })),
)
export type ID = typeof ID.Type

export const Action = Schema.Literals(["allow", "deny", "ask"]).annotate({ identifier: "PermissionAction" })
export type Action = typeof Action.Type

export const Rule = Schema.Struct({ permission: Schema.String, pattern: Schema.String, action: Action }).annotate({
  identifier: "PermissionRule",
})
export type Rule = typeof Rule.Type

export const Ruleset = Schema.Array(Rule).annotate({ identifier: "PermissionRuleset" })
export type Ruleset = typeof Ruleset.Type

const RequestFields = {
  // kilocode_change - managed capability is assigned by the server, not an ask input
  id: ID,
  sessionID: SessionID,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  always: Schema.Array(Schema.String),
  tool: Schema.optional(Schema.Struct({ messageID: Schema.String, callID: Schema.String })),
  // kilocode_change start
}
export const Request = Schema.Struct({
  ...RequestFields,
  managed: optional(
    Schema.Struct({ revision: NonNegativeInt }).annotate({
      description: "Requires an interactive, one-time approval under the organization policy.",
    }),
  ),
}).annotate({ identifier: "PermissionRequest" })
// kilocode_change end
export type Request = typeof Request.Type

// kilocode_change start
export const ManagedState = Schema.Union([
  Schema.Struct({ status: Schema.Literal("personal") }),
  Schema.Struct({
    status: Schema.Literals(["disabled", "active"]),
    organization: Schema.String,
    revision: NonNegativeInt,
    unrestricted: Schema.Boolean,
  }),
  Schema.Struct({
    status: Schema.Literal("unavailable"),
    organization: Schema.String,
    reason: Schema.Literals(["unavailable", "unauthorized", "invalid", "update-required", "client-denied"]),
  }),
]).annotate({ identifier: "PermissionManagedState" })
export type ManagedState = typeof ManagedState.Type
// kilocode_change end

export const Reply = Schema.Literals(["once", "always", "reject"])
export type Reply = typeof Reply.Type

export const ReplyBody = Schema.Struct({
  reply: Reply,
  message: Schema.optional(Schema.String),
  // kilocode_change - set by clients when a human answered a prompt; required to approve protected requests
  interactive: Schema.optional(Schema.Boolean),
}).annotate({
  identifier: "PermissionReplyBody",
})
export type ReplyBody = typeof ReplyBody.Type

export const Approval = Schema.Struct({ projectID: Project.ID, patterns: Schema.Array(Schema.String) }).annotate({
  identifier: "PermissionApproval",
})
export type Approval = typeof Approval.Type

export const AskInput = Schema.Struct({ ...RequestFields, id: Schema.optional(ID), ruleset: Ruleset }).annotate({
  // kilocode_change
  identifier: "PermissionAskInput",
})
export type AskInput = typeof AskInput.Type

export const ReplyInput = Schema.Struct({ requestID: ID, ...ReplyBody.fields }).annotate({
  identifier: "PermissionReplyInput",
})
export type ReplyInput = typeof ReplyInput.Type

const Asked = define({ type: "permission.asked", schema: Request.fields })
const Replied = define({
  type: "permission.replied",
  schema: { sessionID: SessionID, requestID: ID, reply: Reply },
})
export const Event = { Asked, Replied, Definitions: inventory(Asked, Replied) }
