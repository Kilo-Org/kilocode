export * as KiloGateway from "./gateway.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"

export interface Organization extends Schema.Schema.Type<typeof Organization> {}
export const Organization = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  role: optional(Schema.String),
}).annotate({ identifier: "KiloGateway.Organization" })

export interface Profile extends Schema.Schema.Type<typeof Profile> {}
export const Profile = Schema.Struct({
  email: optional(Schema.String),
  name: optional(Schema.NullOr(Schema.String)),
  organizations: Schema.Array(Organization),
  selectedOrganizationId: optional(Schema.NullOr(Schema.String)),
  hasPersonalAccount: optional(Schema.NullOr(Schema.Boolean)),
}).annotate({ identifier: "KiloGateway.Profile" })

export interface Account extends Schema.Schema.Type<typeof Account> {}
export const Account = Schema.Struct({
  profile: Profile,
  currentOrganizationID: Schema.NullOr(Schema.String),
  selectionAvailable: Schema.Boolean,
}).annotate({ identifier: "KiloGateway.Account" })

export interface Balance extends Schema.Schema.Type<typeof Balance> {}
export const Balance = Schema.Struct({
  balance: Schema.Finite,
}).annotate({ identifier: "KiloGateway.Balance" })

export interface KiloPassState extends Schema.Schema.Type<typeof KiloPassState> {}
export const KiloPassState = Schema.Struct({
  currentPeriodBaseCreditsUsd: Schema.Finite,
  currentPeriodUsageUsd: Schema.Finite,
  currentPeriodBonusCreditsUsd: Schema.Finite,
  nextBillingAt: Schema.NullOr(Schema.String),
}).annotate({ identifier: "KiloGateway.KiloPassState" })

export interface AccountBalance extends Schema.Schema.Type<typeof AccountBalance> {}
export const AccountBalance = Schema.Struct({
  currentOrganizationID: Schema.NullOr(Schema.String),
  balance: Schema.NullOr(Balance),
  kiloPass: Schema.NullOr(KiloPassState),
}).annotate({ identifier: "KiloGateway.AccountBalance" })

export interface OrganizationSelection extends Schema.Schema.Type<typeof OrganizationSelection> {}
export const OrganizationSelection = Schema.Struct({
  organizationID: Schema.NullOr(Schema.String.check(Schema.isMinLength(1))),
}).annotate({ identifier: "KiloGateway.OrganizationSelection" })

export const Definition = Rpc.define({
  id: "kilocode.gateway",
  methods: {
    profile: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(Account),
      errors: {
        "kilocode.gateway": Schema.toStandardSchemaV1(Schema.Undefined),
        "kilocode.gateway_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
      },
    },
    balance: {
      input: Schema.toStandardSchemaV1(Schema.Struct({})),
      output: Schema.toStandardSchemaV1(AccountBalance),
      errors: {
        "kilocode.gateway": Schema.toStandardSchemaV1(Schema.Undefined),
        "kilocode.gateway_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
      },
    },
    "organization.set": {
      input: Schema.toStandardSchemaV1(OrganizationSelection),
      output: Schema.toStandardSchemaV1(Account),
      errors: {
        "kilocode.gateway": Schema.toStandardSchemaV1(Schema.Undefined),
        "kilocode.gateway_unavailable": Schema.toStandardSchemaV1(Schema.Undefined),
      },
    },
  },
  events: {},
})
