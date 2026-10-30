export * as KiloSkillRpc from "./skill.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

const portable = Schema.toStandardSchemaV1
const Failure = {
  not_found: portable(Schema.Undefined),
  not_removable: portable(Schema.Undefined),
  remove_failed: portable(Schema.Undefined),
}

export const Definition = Rpc.define({
  id: "kilocode.skill",
  methods: {
    /** Paths of the discovered skills that live in a configured skill directory. */
    removable: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Schema.String)),
      errors: {},
    },
    /** Deletes only the skill manifest, leaving the other files of its directory in place. */
    remove: {
      input: portable(Schema.Struct({ path: Schema.String })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {},
})
