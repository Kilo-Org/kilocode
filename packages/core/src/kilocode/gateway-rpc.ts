export * as KiloGatewayRpc from "./gateway-rpc.js"

import { Rpc } from "@opencode/schema/rpc"
import { Schema } from "effect"

// Standard Schemas, so the promise client of the TUI accepts the contract too.
const portable = Schema.toStandardSchemaV1
const Failure = { unauthorized: portable(Schema.Undefined), failed: portable(Schema.Undefined) }
const OrganizationID = Schema.NullOr(Schema.String)

// The TUI uses this contract for the account picker after login and for /teams, as v1 uses
// `kilo.profile` and `kilo.organization.set`.
export const Definition = Rpc.define({
  id: "kilocode.gateway",
  methods: {
    profile: {
      input: portable(Schema.Struct({})),
      output: portable(
        Schema.Struct({
          email: Schema.String,
          organizations: Schema.Array(
            Schema.Struct({ id: Schema.String, name: Schema.String, role: Schema.optional(Schema.String) }),
          ),
          hasPersonalAccount: Schema.Boolean,
          /** The team that requests use now. `null` is the personal account. */
          organizationID: OrganizationID,
        }),
      ),
      errors: Failure,
    },
    "organization.set": {
      input: portable(Schema.Struct({ organizationID: OrganizationID })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
  },
  events: {
    organization: { schema: portable(Schema.Struct({ organizationID: OrganizationID })) },
  },
})
