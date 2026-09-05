import { IndexingStatus } from "@kilocode/indexing/status"
import { Rpc } from "@opencode-ai/schema/rpc"
import { Schema } from "effect"

/** Status only: reading the sidebar never starts or configures an index. */
export const IndexingRpc = Rpc.define({
  id: "kilocode.indexing",
  methods: {
    status: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: IndexingStatus,
      errors: {},
    },
  },
  events: {},
})
