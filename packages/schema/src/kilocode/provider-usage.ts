export * as ProviderUsage from "./provider-usage"

import { Schema } from "effect"
import { optional } from "../schema"

export interface UsageError extends Schema.Schema.Type<typeof UsageError> {}
export const UsageError = Schema.Struct({
  code: Schema.String,
  message: Schema.String,
  retryable: Schema.Boolean,
}).annotate({ identifier: "ProviderUsageError" })

export interface UsagePeriod extends Schema.Schema.Type<typeof UsagePeriod> {}
export const UsagePeriod = Schema.Struct({
  unit: Schema.Literals(["hour", "day", "week", "month"]),
  value: Schema.Int,
}).annotate({ identifier: "ProviderUsagePeriod" })

export interface UsageWindow extends Schema.Schema.Type<typeof UsageWindow> {}
export const UsageWindow = Schema.Struct({
  id: Schema.String,
  resource: Schema.String,
  unit: Schema.String,
  orientation: Schema.Literals(["used_percent", "remaining_percent", "amount", "count"]),
  used: optional(Schema.Finite),
  remaining: optional(Schema.Finite),
  limit: optional(Schema.Finite),
  period: optional(UsagePeriod),
  durationMs: optional(Schema.Finite),
  resetAt: optional(Schema.String),
  state: Schema.Literals(["active", "exhausted", "unlimited", "not_in_plan", "unknown"]),
}).annotate({ identifier: "ProviderUsageWindow" })

export interface UsageSnapshot extends Schema.Schema.Type<typeof UsageSnapshot> {}
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
  fetchedAt: optional(Schema.String),
  managementUrl: optional(Schema.String),
  windows: Schema.Array(UsageWindow),
  error: optional(UsageError),
}).annotate({ identifier: "ProviderUsageSnapshot" })

export interface Info extends Schema.Schema.Type<typeof Info> {}
export const Info = Schema.Struct({
  items: Schema.Array(UsageSnapshot),
  generatedAt: Schema.String,
}).annotate({ identifier: "ProviderUsage" })
