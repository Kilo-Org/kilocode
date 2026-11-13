export * as KiloSessionDrainRpc from "./session-drain.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.session-drain` RPC contract: wait until a session and everything it started has gone quiet in the
// server process. The session-drain plugin in packages/kilo-plugin registers the handler; clients import this
// contract from `@opencode/schema/kilocode/session-drain`.
const portable = Schema.toStandardSchemaV1

/** A caller-chosen value that the `drained` event repeats, so a client can match the event to its own call. */
export const Token = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128))

export const Drained = Schema.Struct({
  sessionID: SessionID,
  token: Token,
}).annotate({ identifier: "KiloSessionDrained" })
export type Drained = typeof Drained.Type

export const Definition = Rpc.define({
  id: "kilocode.session-drain",
  methods: {
    /**
     * Resolves once this process runs nothing more for the session: no foreground execution (follow-up runs and a
     * successor started during interruption cleanup included), no execution of a descendant session in any Location,
     * and no background job of the session or a descendant, nor its result delivery. It never starts or resumes work,
     * and cancelling the call cancels no work. Quiet is not success and does not rule out later work; tracking is
     * process-local and does not survive a restart. With a token, the `drained` event is published before the call
     * returns. A finished job whose notice stays pending for 30 seconds fails with `delivery_timeout`.
     */
    drain: {
      input: portable(Schema.Struct({ sessionID: SessionID, token: optional(Token) })),
      output: portable(Schema.Boolean),
      errors: { not_found: portable(Schema.Undefined), delivery_timeout: portable(Schema.Undefined) },
    },
  },
  events: {
    // kilo_port(goals:32d5a987d3b1) v1 listed the drain events in the event manifest; an RPC event registers with its contract.
    drained: { schema: portable(Drained) },
  },
})
