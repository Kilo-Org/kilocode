export * as KiloBranchNameRpc from "./branch-name.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionID } from "../session-id.js"

// The `kilocode.branch-name` RPC contract: a task-focused git branch name from the recent user messages of a session.
// The branch-name plugin in packages/kilo-plugin registers the handler; clients import this contract from
// `@opencode/schema/kilocode/branch-name`.
const portable = Schema.toStandardSchemaV1

export const Input = Schema.Struct({
  sessionID: SessionID,
  /** The pending prompt, which is not yet part of the session history. */
  prompt: Schema.String,
  /** Provider of the invoking turn. The small model of this provider is preferred. */
  providerID: optional(Schema.String),
  /** Model of the invoking turn, used when the provider has no small model. */
  modelID: optional(Schema.String),
}).annotate({ identifier: "BranchNameInput" })
export type Input = Schema.Schema.Type<typeof Input>

export const Output = Schema.Struct({
  /** The generated kebab-case branch slug, or null when no clear workstream exists yet. */
  branch: Schema.NullOr(Schema.String),
}).annotate({ identifier: "BranchNameOutput" })
export type Output = Schema.Schema.Type<typeof Output>

export const Definition = Rpc.define({
  id: "kilocode.branch-name",
  methods: {
    generate: {
      input: portable(Input),
      output: portable(Output),
      errors: {},
    },
  },
  events: {},
})
