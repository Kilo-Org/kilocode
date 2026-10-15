export * as KiloGatewayRpc from "./gateway-rpc.js"

import { Rpc } from "@opencode/schema/rpc"
import { Schema } from "effect"

// Standard Schemas, so the promise client of the TUI accepts the contract too.
const portable = Schema.toStandardSchemaV1
const Failure = { unauthorized: portable(Schema.Undefined), failed: portable(Schema.Undefined) }
const OrganizationID = Schema.NullOr(Schema.String)

export const Profile = Schema.Struct({
  email: Schema.String,
  organizations: Schema.Array(
    Schema.Struct({ id: Schema.String, name: Schema.String, role: Schema.optional(Schema.String) }),
  ),
  hasPersonalAccount: Schema.Boolean,
  /** The team that requests use now. `null` is the personal account. */
  organizationID: OrganizationID,
})

export type Profile = typeof Profile.Type

export const ModelEntry = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  isFree: Schema.Boolean,
  recommendedIndex: Schema.optional(Schema.Number),
  hasUserByokAvailable: Schema.optional(Schema.Boolean),
  mayTrainOnYourPrompts: Schema.optional(Schema.Boolean),
  autoRouting: Schema.optional(
    Schema.Struct({
      models: Schema.Array(Schema.String),
    }),
  ),
  terminalBench: Schema.optional(
    Schema.Struct({
      overallScore: Schema.Number,
      avgAttemptCostUsd: Schema.Number,
    }),
  ),
  description: Schema.optional(Schema.String),
  reasoning: Schema.optional(Schema.Boolean),
  family: Schema.optional(Schema.String),
  aiSDKProvider: Schema.optional(Schema.String),
})

export type ModelEntry = typeof ModelEntry.Type

export const SessionMetadata = Schema.Struct({
  routedModelID: Schema.optional(Schema.String),
  vercelID: Schema.optional(Schema.String),
})

export type SessionMetadata = typeof SessionMetadata.Type

// The TUI and IDE clients use this contract for the account picker after login, /teams,
// Kilo-specific model catalog metadata, and per-session routed model metadata.
export const Definition = Rpc.define({
  id: "kilocode.gateway",
  methods: {
    profile: {
      input: portable(Schema.Struct({})),
      output: portable(Profile),
      errors: Failure,
    },
    "organization.set": {
      input: portable(Schema.Struct({ organizationID: OrganizationID })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
    models: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(ModelEntry)),
      errors: Failure,
    },
    "session.metadata": {
      input: portable(Schema.Struct({ sessionID: Schema.String })),
      output: portable(SessionMetadata),
      errors: Failure,
    },
  },
  events: {
    organization: { schema: portable(Schema.Struct({ organizationID: OrganizationID })) },
  },
})
