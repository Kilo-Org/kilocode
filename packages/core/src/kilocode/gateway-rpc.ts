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

export const AuthStatus = Schema.Struct({
  authenticated: Schema.Boolean,
  organizationID: OrganizationID,
  server: Schema.String,
})

export type AuthStatus = typeof AuthStatus.Type

export const Balance = Schema.Struct({
  balance: Schema.NullOr(Schema.Number),
  isDepleted: Schema.optional(Schema.Boolean),
})

export type Balance = typeof Balance.Type

export const KiloPass = Schema.NullOr(
  Schema.Struct({
    currentPeriodBaseCreditsUsd: Schema.Number,
    currentPeriodUsageUsd: Schema.Number,
    currentPeriodBonusCreditsUsd: Schema.Number,
    nextBillingAt: Schema.NullOr(Schema.String),
  }),
)

export type KiloPass = typeof KiloPass.Type

export const ByokEntry = Schema.Struct({
  id: Schema.String,
  provider_id: Schema.String,
  management_source: Schema.Literals(["user", "coding_plan"]),
  is_enabled: Schema.Boolean,
})

export type ByokEntry = typeof ByokEntry.Type

export const CodingPlanSubscription = Schema.Struct({
  id: Schema.String,
  planId: Schema.String,
  planName: Schema.String,
  providerName: Schema.String,
  providerId: Schema.String,
  canQueryUsage: Schema.Boolean,
  hasInstalledByokKey: Schema.Boolean,
  status: Schema.Literals(["active", "past_due", "canceled"]),
  cancelAtPeriodEnd: Schema.Boolean,
})

export type CodingPlanSubscription = typeof CodingPlanSubscription.Type

export const CodingPlanUsage = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  fetchedAt: Schema.String,
  subscription: Schema.Struct({
    id: Schema.String,
    planName: Schema.String,
    providerId: Schema.String,
    providerName: Schema.String,
    windows: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        remainingPercent: Schema.Number,
        resetsAt: Schema.String,
        startsAt: Schema.optional(Schema.String),
        period: Schema.Struct({
          unit: Schema.Literals(["hour", "day", "week", "month"]),
          value: Schema.Number,
        }),
      }),
    ),
  }),
})

export type CodingPlanUsage = typeof CodingPlanUsage.Type

export const OrganizationMode = Schema.Struct({
  id: Schema.String,
  organization_id: Schema.String,
  name: Schema.String,
  slug: Schema.String,
  created_by: Schema.String,
  created_at: Schema.String,
  updated_at: Schema.String,
  config: Schema.Struct({
    roleDefinition: Schema.optional(Schema.String),
    whenToUse: Schema.optional(Schema.String),
    description: Schema.optional(Schema.String),
    customInstructions: Schema.optional(Schema.String),
    groups: Schema.optional(
      Schema.Array(
        Schema.Union([
          Schema.String,
          Schema.Tuple([
            Schema.String,
            Schema.Struct({
              fileRegex: Schema.optional(Schema.String),
              description: Schema.optional(Schema.String),
            }),
          ]),
        ]),
      ),
    ),
  }),
})

export type OrganizationMode = typeof OrganizationMode.Type

export const Notification = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  message: Schema.String,
  action: Schema.optional(
    Schema.Struct({
      actionText: Schema.String,
      actionURL: Schema.String,
    }),
  ),
  showIn: Schema.optional(Schema.Array(Schema.String)),
  suggestModelId: Schema.optional(Schema.String),
})

export type Notification = typeof Notification.Type

export const ImageModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.String),
})

export type ImageModel = typeof ImageModel.Type

export const TranscriptionModel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
})

export type TranscriptionModel = typeof TranscriptionModel.Type

export const FimTarget = Schema.Struct({
  provider: Schema.Literals(["kilo", "inception", "mistral"]),
  model: Schema.String,
  url: Schema.optional(Schema.String),
})

export const EditTarget = Schema.Struct({
  provider: Schema.Literals(["kilo", "inception"]),
  model: Schema.String,
  url: Schema.String,
})

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
  prompt: Schema.optional(Schema.String),
  aiSDKProvider: Schema.optional(Schema.String),
})

export type ModelEntry = typeof ModelEntry.Type

export const SessionMetadata = Schema.Struct({
  routedModelID: Schema.optional(Schema.String),
  vercelID: Schema.optional(Schema.String),
})

export type SessionMetadata = typeof SessionMetadata.Type

// The TUI, VS Code, and JetBrains clients use this contract for account/profile, balance, Kilo Pass,
// BYOK, coding plans, team modes, notifications, media models, and FIM/edit routing.
export const Definition = Rpc.define({
  id: "kilocode.gateway",
  methods: {
    authStatus: {
      input: portable(Schema.Struct({})),
      output: portable(AuthStatus),
      errors: Failure,
    },
    profile: {
      input: portable(Schema.Struct({})),
      output: portable(Profile),
      errors: Failure,
    },
    balance: {
      input: portable(Schema.Struct({})),
      output: portable(Balance),
      errors: Failure,
    },
    kiloPass: {
      input: portable(Schema.Struct({})),
      output: portable(KiloPass),
      errors: Failure,
    },
    byok: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(ByokEntry)),
      errors: Failure,
    },
    codingPlans: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(CodingPlanSubscription)),
      errors: Failure,
    },
    codingPlanUsage: {
      input: portable(Schema.Struct({ subscriptionID: Schema.String })),
      output: portable(CodingPlanUsage),
      errors: Failure,
    },
    "organization.set": {
      input: portable(Schema.Struct({ organizationID: OrganizationID })),
      output: portable(Schema.Struct({})),
      errors: Failure,
    },
    modes: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(OrganizationMode)),
      errors: Failure,
    },
    notifications: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(Notification)),
      errors: Failure,
    },
    models: {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(ModelEntry)),
      errors: Failure,
    },
    "models.images": {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(ImageModel)),
      errors: Failure,
    },
    "models.transcriptions": {
      input: portable(Schema.Struct({})),
      output: portable(Schema.Array(TranscriptionModel)),
      errors: Failure,
    },
    "autocomplete.fimTarget": {
      input: portable(Schema.Struct({ provider: Schema.optional(Schema.String), model: Schema.optional(Schema.String) })),
      output: portable(FimTarget),
      errors: Failure,
    },
    "autocomplete.editTarget": {
      input: portable(Schema.Struct({ provider: Schema.optional(Schema.String), model: Schema.optional(Schema.String) })),
      output: portable(EditTarget),
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
