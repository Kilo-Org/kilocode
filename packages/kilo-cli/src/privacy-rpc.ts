import { Rpc } from "@opencode-ai/schema/rpc"
import { Schema } from "effect"

const emptyInput = Schema.toStandardSchemaV1(Schema.Struct({}))
const setInput = Schema.toStandardSchemaV1(Schema.Struct({ enabled: Schema.Boolean }))
const rpcErrors = {
  "kilocode.privacy": Schema.toStandardSchemaV1(Schema.Undefined),
}

/** The privacy setting is deliberately profile-only in the isolated Kilo host. */
export const PrivacyState = Schema.Struct({
  enabled: Schema.Boolean,
  scope: Schema.Literal("profile"),
})
export type PrivacyState = Schema.Schema.Type<typeof PrivacyState>

/** Public local privacy controls. They never admit a session item or expose profile data. */
export namespace PrivacyRpc {
  export const Definition = Rpc.define({
    id: "kilocode.privacy",
    methods: {
      read: {
        input: emptyInput,
        output: Schema.toStandardSchemaV1(PrivacyState),
        errors: rpcErrors,
      },
      set: {
        input: setInput,
        output: Schema.toStandardSchemaV1(PrivacyState),
        errors: rpcErrors,
      },
    },
    events: {
      // The setting is stored in the one isolated profile document owned by a
      // launch, so every location served by that launch must receive updates.
      updated: { schema: Schema.toStandardSchemaV1(PrivacyState) },
    },
  })
}
