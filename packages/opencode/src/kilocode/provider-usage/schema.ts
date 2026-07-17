import { Schema } from "effect"

export const UsageError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
}).annotate({ identifier: "ProviderUsageError" })
export type UsageError = typeof UsageError.Type

export const UsageWindow = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  resource: Schema.String,
  kind: Schema.Literals(["quota", "spend_control"]),
  unit: Schema.String,
  orientation: Schema.Literals(["used_percent", "remaining_percent", "amount", "count"]),
  used: Schema.optional(Schema.Finite),
  remaining: Schema.optional(Schema.Finite),
  limit: Schema.optional(Schema.Finite),
  durationMs: Schema.optional(Schema.Finite),
  resetAt: Schema.optional(Schema.String),
  state: Schema.Literals(["active", "exhausted", "unlimited", "not_in_plan", "unknown"]),
}).annotate({ identifier: "ProviderUsageWindow" })
export type UsageWindow = typeof UsageWindow.Type

export const UsageBalance = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  currency: Schema.String,
  unit: Schema.String,
  total: Schema.String,
  granted: Schema.optional(Schema.String),
  toppedUp: Schema.optional(Schema.String),
  available: Schema.optional(Schema.Boolean),
}).annotate({ identifier: "ProviderUsageBalance" })
export type UsageBalance = typeof UsageBalance.Type

export const UsageCredit = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  balance: Schema.optional(Schema.String),
  unit: Schema.optional(Schema.String),
  unlimited: Schema.optional(Schema.Boolean),
  availableResets: Schema.optional(Schema.Finite),
}).annotate({ identifier: "ProviderUsageCredit" })
export type UsageCredit = typeof UsageCredit.Type

export const UsageSnapshot = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  sourceKind: Schema.Literals(["kilo_managed", "direct", "codex"]),
  providerLabel: Schema.String,
  planLabel: Schema.String,
  sourceLabel: Schema.String,
  accountLabel: Schema.optional(Schema.String),
  fetchState: Schema.Literals(["ready", "stale", "unavailable", "error"]),
  planState: Schema.Literals(["active", "past_due", "canceling", "unknown"]),
  routingState: Schema.Literals(["active", "disabled", "missing", "replaced", "not_applicable", "unknown"]),
  availabilityState: Schema.Literals(["available", "exhausted", "unavailable", "unlimited", "unknown"]),
  fetchedAt: Schema.optional(Schema.String),
  confidence: Schema.Literals(["high", "medium", "low"]),
  source: Schema.Literals(["cloud", "provider_api", "provider_backend"]),
  managementUrl: Schema.optional(Schema.String),
  windows: Schema.Array(UsageWindow),
  balances: Schema.Array(UsageBalance),
  credits: Schema.Array(UsageCredit),
  error: Schema.optional(UsageError),
}).annotate({ identifier: "ProviderUsageSnapshot" })
export type UsageSnapshot = typeof UsageSnapshot.Type

export const AutoTopUp = Schema.Struct({
  enabled: Schema.Boolean,
  amountCents: Schema.Finite,
  thresholdDollars: Schema.Finite,
  paymentType: Schema.optional(Schema.String),
  paymentBrand: Schema.optional(Schema.String),
  paymentLast4: Schema.optional(Schema.String),
}).annotate({ identifier: "ProviderUsageAutoTopUp" })
export type AutoTopUp = typeof AutoTopUp.Type

export const KiloBilling = Schema.Struct({
  topUpUrl: Schema.String,
  manageUrl: Schema.String,
  autoTopUp: Schema.optional(AutoTopUp),
  error: Schema.optional(UsageError),
}).annotate({ identifier: "ProviderUsageKiloBilling" })
export type KiloBilling = typeof KiloBilling.Type

export const Info = Schema.Struct({
  items: Schema.Array(UsageSnapshot),
  kiloBilling: Schema.optional(KiloBilling),
  generatedAt: Schema.String,
}).annotate({ identifier: "ProviderUsage" })
export type Info = typeof Info.Type
