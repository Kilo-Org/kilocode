import { BusEvent } from "@/bus/bus-event"
import { SessionID } from "@/session/schema"
import { NonNegativeInt } from "@opencode-ai/core/schema"
import { Schema } from "effect"

export const RequestID = Schema.String.pipe(Schema.brand("IdeLspRequestID")).annotate({
  identifier: "IdeLspRequestID",
})
export type RequestID = Schema.Schema.Type<typeof RequestID>

export const Operation = Schema.Literals([
  "goToDefinition",
  "findReferences",
  "goToImplementation",
  "workspaceSymbol",
  "documentSymbol",
  "typeHierarchy",
])
export type Operation = Schema.Schema.Type<typeof Operation>

export const Request = Schema.Struct({
  id: RequestID,
  sessionID: SessionID,
  operation: Operation,
  filePath: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4096)),
  line: Schema.optional(NonNegativeInt),
  character: Schema.optional(NonNegativeInt),
  query: Schema.optional(Schema.String.check(Schema.isMaxLength(1000))),
}).annotate({ identifier: "IdeLspRequest" })
export type Request = Schema.Schema.Type<typeof Request>

export const Entry = Schema.Struct({
  name: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  kind: Schema.optional(Schema.String.check(Schema.isMaxLength(100))),
  filePath: Schema.String,
  startLine: NonNegativeInt,
  endLine: NonNegativeInt,
  preview: Schema.optional(Schema.String.check(Schema.isMaxLength(2000))),
}).annotate({ identifier: "IdeLspEntry" })
export type Entry = Schema.Schema.Type<typeof Entry>

export const Status = Schema.Literals(["ready", "indexing", "unavailable"])
export type Status = Schema.Schema.Type<typeof Status>

export const Result = Schema.Struct({
  operation: Operation,
  status: Schema.optional(Status),
  reason: Schema.optional(Schema.String.check(Schema.isMaxLength(500))),
  entries: Schema.Array(Entry).check(Schema.isMaxLength(500)),
  supertypes: Schema.optional(Schema.Array(Entry).check(Schema.isMaxLength(500))),
  subtypes: Schema.optional(Schema.Array(Entry).check(Schema.isMaxLength(500))),
}).annotate({ identifier: "IdeLspResult" })
export type Result = Schema.Schema.Type<typeof Result>

export const ErrorCode = Schema.Literals([
  "cancelled",
  "disconnected",
  "timeout",
  "indexing",
  "invalid_path",
  "not_found",
  "unsupported",
])
export type ErrorCode = Schema.Schema.Type<typeof ErrorCode>

export const Failure = Schema.Struct({
  code: ErrorCode,
  message: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(10_000)),
}).annotate({ identifier: "IdeLspFailure" })
export type Failure = Schema.Schema.Type<typeof Failure>

export const Event = {
  Requested: BusEvent.define("kilocode.ideLsp.requested", Request),
  Cancelled: BusEvent.define(
    "kilocode.ideLsp.cancelled",
    Schema.Struct({
      requestID: RequestID,
      sessionID: SessionID,
      reason: Schema.Literals(["cancelled", "disposed", "timeout"]),
    }),
  ),
}
