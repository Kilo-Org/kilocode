/**
 * Shared display formatting for provider usage windows.
 *
 * This is the single source of truth for how a quota window is presented.
 * Both the TUI dialog (packages/opencode) and the VS Code webview consume it
 * so the two surfaces can never drift; labels are injectable for i18n.
 */

export interface UsagePeriodLike {
  unit: "hour" | "day" | "week" | "month"
  value: number
}

export interface UsageWindowLike {
  state: "active" | "exhausted" | "unlimited" | "not_in_plan" | "unknown"
  orientation: "used_percent" | "remaining_percent" | "amount" | "count"
  unit: string
  resource: string
  period?: UsagePeriodLike
  used?: number
  remaining?: number
  limit?: number
}

export interface UsageLabels {
  unlimited: string
  notInPlan: string
  unknown: string
  exhausted: string
  used(value: string): string
  remaining(value: string): string
  remainingOf(value: string, limit: string): string
  usedOf(value: string, limit: string): string
  quota: string
  daily: string
  weekly: string
  monthly: string
  hours(count: number): string
  days(count: number): string
  weeks(count: number): string
  months(count: number): string
  /** Display name for MiniMax's pooled "general" resource. */
  shared: string
  scoped(resource: string, period: string): string
}

export const english: UsageLabels = {
  unlimited: "Unlimited",
  notInPlan: "Not in plan",
  unknown: "Unknown",
  exhausted: "Exhausted",
  used: (value) => `${value} used`,
  remaining: (value) => `${value} remaining`,
  remainingOf: (value, limit) => `${value} of ${limit} remaining`,
  usedOf: (value, limit) => `${value} of ${limit} used`,
  quota: "Quota",
  daily: "Daily quota",
  weekly: "Weekly quota",
  monthly: "Monthly quota",
  hours: (count) => `${count}-hour quota`,
  days: (count) => `${count}-day quota`,
  weeks: (count) => `${count}-week quota`,
  months: (count) => `${count}-month quota`,
  shared: "Shared",
  scoped: (resource, period) => `${resource} · ${period}`,
}

const period = (value: UsagePeriodLike, labels: UsageLabels) => {
  if (value.unit === "hour") return labels.hours(value.value)
  if (value.unit === "day") return value.value === 1 ? labels.daily : labels.days(value.value)
  if (value.unit === "week") return value.value === 1 ? labels.weekly : labels.weeks(value.value)
  return value.value === 1 ? labels.monthly : labels.months(value.value)
}

export const windowLabel = (window: UsageWindowLike, labels: UsageLabels = english) => {
  const phrase = window.period ? period(window.period, labels) : labels.quota
  // Plan-level windows ("subscription") are the whole card; named resources prefix theirs.
  if (window.resource === "subscription") return phrase
  return labels.scoped(window.resource === "general" ? labels.shared : window.resource, phrase)
}

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })

const amount = (value: number, unit: string) => {
  if (unit === "USD") return `$${value.toFixed(2)}`
  if (unit === "percent") return `${number(value)}%`
  if (unit === "count") return number(value)
  return `${number(value)} ${unit}`
}

export const formatWindow = (window: UsageWindowLike, labels: UsageLabels = english) => {
  if (window.state === "unlimited") return labels.unlimited
  if (window.state === "not_in_plan") return labels.notInPlan
  if (window.state === "unknown") return labels.unknown
  if (window.orientation === "used_percent" && window.used !== undefined) return labels.used(`${number(window.used)}%`)
  if (window.orientation === "remaining_percent" && window.remaining !== undefined)
    return labels.remaining(`${number(window.remaining)}%`)
  if (window.remaining !== undefined && window.limit !== undefined)
    return labels.remainingOf(amount(window.remaining, window.unit), amount(window.limit, window.unit))
  if (window.used !== undefined && window.limit !== undefined)
    return labels.usedOf(amount(window.used, window.unit), amount(window.limit, window.unit))
  return window.state === "exhausted" ? labels.exhausted : labels.unknown
}

export const windowProgress = (window: UsageWindowLike) => {
  if (window.limit === undefined || window.limit <= 0) return undefined
  if (window.used !== undefined) return Math.min(100, Math.max(0, (window.used / window.limit) * 100))
  if (window.remaining !== undefined) return Math.min(100, Math.max(0, 100 - (window.remaining / window.limit) * 100))
  return undefined
}
