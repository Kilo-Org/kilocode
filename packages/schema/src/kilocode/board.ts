export * as KiloBoardRpc from "./board.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.board` RPC contract: Kilo Swarm, the shared agent board of one main session and its subagents. The
// board plugin in packages/kilo-plugin registers the handlers and the board_read and board_post tools; clients import
// this contract from `@opencode/schema/kilocode/board`.
const portable = Schema.toStandardSchemaV1

const Integer = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

export const Kind = Schema.Literals(["INFO", "ASK", "RESULT", "HOLD", "VETO"])
export type Kind = typeof Kind.Type

export const Message = Schema.Struct({
  id: Schema.String,
  timestamp: Integer,
  /** `main` for the board root, else the sender's session ID. */
  from: Schema.String,
  /** `main`, `ALL`, or a recipient session ID. */
  to: Schema.String,
  fromLabel: optional(Schema.String),
  toLabel: optional(Schema.String),
  type: Kind,
  body: Schema.String,
  reply_to: optional(Schema.String),
}).annotate({ identifier: "KiloBoardMessage" })
export type Message = typeof Message.Type

/** The board of one main session, newest page first in time order. */
export const Board = Schema.Struct({
  ownerSessionID: SessionID,
  revision: Integer,
  messages: Schema.Array(Message),
  /** Pass as `before` to load the previous page. */
  cursor: optional(Schema.String),
  hasMore: Schema.Boolean,
}).annotate({ identifier: "KiloBoard" })
export type Board = typeof Board.Type

export const Changed = Schema.Struct({
  /** The board root: the main session of the family. */
  sessionID: SessionID,
  revision: Integer,
}).annotate({ identifier: "KiloBoardChanged" })
export type Changed = typeof Changed.Type

export const Definition = Rpc.define({
  id: "kilocode.board",
  methods: {
    /** Whether Kilo Swarm is enabled for this location (`shared_agent_board`, on by default). */
    status: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Struct({ enabled: Schema.Boolean })),
    },
    /** Read the board of the main session. A read never creates a board. */
    get: {
      input: portable(
        Schema.Struct({
          sessionID: SessionID,
          before: optional(Schema.String),
          limit: optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
        }),
      ),
      output: portable(Board),
      errors: { not_found: portable(Schema.Undefined), invalid: portable(Schema.Undefined) },
    },
    /** Clear the visible messages without changing conversations or running subagents. Only the main session. */
    reset: {
      input: portable(Schema.Struct({ sessionID: SessionID, revision: Integer })),
      output: portable(Board),
      errors: {
        not_found: portable(Schema.Undefined),
        invalid: portable(Schema.Undefined),
        conflict: portable(Schema.Undefined),
      },
    },
  },
  events: {
    changed: { schema: portable(Changed) },
  },
})
