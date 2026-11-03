export * as KiloPrivacyRpc from "./privacy.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"

// The `kilocode.privacy` RPC contract: whether privacy mode (the `privacy_mode` config key) is on for a location. The
// privacy plugin in packages/kilo-plugin registers the handler; clients import this contract from
// `@opencode/schema/kilocode/privacy`. The upstream config route does not carry Kilo keys, so clients read the key
// here, and read it again after `config.updated`.
const portable = Schema.toStandardSchemaV1

export const Status = Schema.Struct({
  /** True when any effective config document of the location sets `privacy_mode: true`. */
  enabled: Schema.Boolean,
})

export type Status = typeof Status.Type

export const Definition = Rpc.define({
  id: "kilocode.privacy",
  methods: {
    get: {
      input: portable(Schema.Struct({})),
      output: portable(Status),
    },
  },
  events: {},
})
