export * as KiloCommitMessageRpc from "./commit-message.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

// The `kilocode.commit-message` RPC contract: a commit message for the changes of a git repository. The commit
// message plugin in packages/kilo-plugin registers the handler; clients import this contract from
// `@opencode/schema/kilocode/commit-message`.
const portable = Schema.toStandardSchemaV1

export interface Input extends Schema.Schema.Type<typeof Input> {}
export const Input = Schema.Struct({
  /** Repository root. */
  path: Schema.String,
  /** Only these repository-relative paths, when set. */
  selectedFiles: optional(Schema.Array(Schema.String)),
  /** The last message generated for this repository: the model is asked for a different one. */
  previousMessage: optional(Schema.String),
  /** Locale of the message, for example `de` or `zh`. Omitted or `en` adds no language instruction. */
  language: optional(Schema.String),
}).annotate({ identifier: "CommitMessageInput" })

export const Definition = Rpc.define({
  id: "kilocode.commit-message",
  methods: {
    /** Uses the staged changes, or every change when nothing is staged. */
    generate: {
      input: portable(Input),
      output: portable(Schema.Struct({ message: Schema.String })),
      errors: {
        /** No change to describe after the lock file and selection filters. */
        no_changes: portable(Schema.Undefined),
        /** The model failed or timed out; the message says why. */
        failed: portable(Schema.Undefined),
      },
    },
  },
  events: {},
})
