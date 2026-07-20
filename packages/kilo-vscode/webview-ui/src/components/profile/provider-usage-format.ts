import type { ProviderUsageWindow } from "@kilocode/sdk/v2/client"

const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 })

const amount = (value: number, unit: string) => {
  if (unit === "USD") return `$${value.toFixed(2)}`
  if (unit === "percent") return `${number(value)}%`
  if (unit === "count") return number(value)
  return `${number(value)} ${unit}`
}

interface Labels {
  unlimited: string
  notInPlan: string
  unknown: string
  exhausted: string
  used(value: string): string
  remaining(value: string): string
  remainingOf(value: string, limit: string): string
  usedOf(value: string, limit: string): string
}

const english: Labels = {
  unlimited: "Unlimited",
  notInPlan: "Not in plan",
  unknown: "Unknown",
  exhausted: "Exhausted",
  used: (value) => `${value} used`,
  remaining: (value) => `${value} remaining`,
  remainingOf: (value, limit) => `${value} of ${limit} remaining`,
  usedOf: (value, limit) => `${value} of ${limit} used`,
}

export const formatWindowValue = (window: ProviderUsageWindow, labels: Labels = english) => {
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

export const windowProgress = (window: ProviderUsageWindow) => {
  if (window.limit === undefined || window.limit <= 0) return undefined
  if (window.used !== undefined) return Math.min(100, Math.max(0, (window.used / window.limit) * 100))
  if (window.remaining !== undefined) return Math.min(100, Math.max(0, 100 - (window.remaining / window.limit) * 100))
  return undefined
}
