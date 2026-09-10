import { Rpc } from "../rpc.js"
import { Schema } from "effect"

export const RemoteStatus = Schema.Struct({
  enabled: Schema.Boolean,
  connected: Schema.Boolean,
  directory: Schema.String,
  note: Schema.String,
})

export const REMOTE_LIMITATION =
  "Preview control adapter only: legacy transcript forwarding, URL-backed attachments and cloud-session cloning are not available. Inline data attachments are supported. Enabling advertises sessions in this location and permits supported remote commands under their native permissions."

const method = {
  input: Schema.toStandardSchemaV1(Schema.Struct({})),
  output: Schema.toStandardSchemaV1(RemoteStatus),
  errors: { "kilocode.remote": Schema.toStandardSchemaV1(Schema.Undefined) },
}

export const RemoteRpc = Rpc.define({
  id: "kilocode.remote",
  methods: { status: method, enable: method, disable: method },
  events: {},
})
