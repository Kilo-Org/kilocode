export * as KiloRemoteRpc from "./remote.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

const portable = Schema.toStandardSchemaV1

export const Status = Schema.Struct({
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
}).annotate({ identifier: "KiloRemote.Status" })
export interface Status extends Schema.Schema.Type<typeof Status> {}

export const Failure = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
}).annotate({ identifier: "KiloRemote.Failure" })
export interface Failure extends Schema.Schema.Type<typeof Failure> {}

const method = {
  input: portable(Schema.Struct({})),
  output: portable(Status),
  errors: { failed: portable(Failure) },
}

export const Definition = Rpc.define({
  id: "kilocode.remote",
  methods: { status: method, enable: method, disable: method },
  events: {},
})
