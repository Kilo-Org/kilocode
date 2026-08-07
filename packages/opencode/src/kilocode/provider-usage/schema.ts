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

export const UsageSnapshot = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  sourceKind: Schema.Literals(["kilo_managed", "direct"]),
  providerLabel: Schema.String,
  planLabel: Schema.String,
  sourceLabel: Schema.String,
  fetchState: Schema.Literals(["ready", "stale", "unavailable", "error"]),
  planState: Schema.Literals(["active", "past_due", "canceling", "unknown"]),
  routingState: Schema.Literals(["active", "disabled", "missing", "replaced", "not_applicable", "unknown"]),
  fetchedAt: Schema.optional(Schema.String),
  managementUrl: Schema.optional(Schema.String),
  windows: Schema.Array(UsageWindow),
  error: Schema.optional(UsageError),
}).annotate({ identifier: "ProviderUsageSnapshot" })
export type UsageSnapshot = typeof UsageSnapshot.Type

export const Info = Schema.Struct({
  items: Schema.Array(UsageSnapshot),
  generatedAt: Schema.String,
}).annotate({ identifier: "ProviderUsage" })
export type Info = typeof Info.Type
