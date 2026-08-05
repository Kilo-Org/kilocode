/**
 * Shared display formatting for provider usage windows.
 *
 * This is the single source of truth for how a quota window is presented.
 * Both the TUI dialog (packages/opencode) and the VS Code webview consume it
 * so the two surfaces can never drift; labels are injectable for i18n.
 */

export interface UsageWindowLike {
  state: "active" | "exhausted" | "unlimited" | "not_in_plan" | "unknown"
  orientation: "used_percent" | "remaining_percent" | "amount" | "count"
  unit: string
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
