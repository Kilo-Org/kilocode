export * as KiloAgentRpc from "./agent.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

const portable = Schema.toStandardSchemaV1
const Failure = {
  not_found: portable(Schema.Undefined),
  not_removable: portable(Schema.Undefined),
  remove_failed: portable(Schema.Undefined),
}

export const Definition = Rpc.define({
  id: "kilocode.agent",
  methods: {
    /** The agents that a removal may delete, each with the file that defines it and the scope that file belongs to. */
    removable: {
      input: portable(Schema.Struct({})),
      output: portable(
        Schema.Array(
          Schema.Struct({
            name: Schema.String,
            path: Schema.String,
            scope: Schema.Literals(["global", "project"]),
          }),
        ),
      ),
      errors: {},
    },
    /**
     * Deletes the markdown definition of the agent in the selected scope, or in every editable scope when omitted.
     * `not_removable` means the registry knows the agent but no deletable file defines it, such as a built-in agent.
     */
    remove: {
      input: portable(
        Schema.Struct({
          name: Schema.String,
          scope: Schema.optional(Schema.Literals(["global", "project"])),
        }),
      ),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {},
})
