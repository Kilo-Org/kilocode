export * as KiloHandshakeRpc from "./handshake.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

// The `kilocode.handshake` RPC contract: the identity of a Kilo v2 server. The handshake plugin in
// packages/kilo-plugin registers the handler; clients (TUI, VS Code, JetBrains) import this contract from
// `@opencode/schema/kilocode/handshake`.
//
// A client calls `get` first to confirm that it talks to a Kilo v2 server. The other servers answer differently: an
// upstream OpenCode server has no `kilocode.handshake` RPC (RPC error `rpc.unavailable`), and a Kilo v1 server has no
// `/api/rpc` route (HTTP 404).
const portable = Schema.toStandardSchemaV1

export const Info = Schema.Struct({
  /** Always `kilo`. The app name of the server can be the name of the client that started it (`KILO_CLIENT`). */
  product: Schema.Literal("kilo"),
  /** The Kilo version of the server build. */
  version: Schema.String,
  /** The release channel of the server build. */
  channel: Schema.String,
})

export type Info = typeof Info.Type

export const Definition = Rpc.define({
  id: "kilocode.handshake",
  methods: {
    get: {
      input: portable(Schema.Struct({})),
      output: portable(Info),
    },
  },
  events: {},
})
