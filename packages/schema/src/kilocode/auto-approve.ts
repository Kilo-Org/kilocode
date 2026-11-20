export * as KiloAutoApproveRpc from "./auto-approve.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

// The `kilocode.auto-approve` RPC contract: effective auto-approve state (`auto_approve` across every loaded config
// document of a location). The auto-approve plugin in packages/kilo-plugin registers the handler; clients import this
// contract from `@opencode/schema/kilocode/auto-approve` so they see the exact same effective state the server uses.
const portable = Schema.toStandardSchemaV1

export const State = Schema.Literals(["enabled", "narrowed", "disabled"]).annotate({
  identifier: "KiloAutoApprove.State",
})
export type State = typeof State.Type

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  /** `enabled` when global config turns `auto_approve` on, `narrowed` when a non-global doc sets `false`, else `disabled`. */
  state: State,
}).annotate({ identifier: "KiloAutoApprove.Status" })

export const Definition = Rpc.define({
  id: "kilocode.auto-approve",
  methods: {
    get: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
  },
  events: {},
})
