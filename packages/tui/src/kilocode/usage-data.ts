// Data of the Kilo `/usage` dialog: session family totals and quota window labels. Same rules as v1
// (packages/opencode/src/kilocode/plugins/model-usage.ts and packages/kilo-gateway/src/provider-usage.ts on main).
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"

const count = new Intl.NumberFormat("en-US")
const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" })
const rate = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 })

/** Token totals of a session family and its generation speed over the completed steps. */
export function familyUsage(sessions: readonly SessionInfo[], messages: readonly SessionMessageInfo[]) {
  const tokens = sessions.reduce(
    (total, session) => ({
      input: total.input + session.tokens.input,
      output: total.output + session.tokens.output,
      reasoning: total.reasoning + session.tokens.reasoning,
      read: total.read + session.tokens.cache.read,
      write: total.write + session.tokens.cache.write,
    }),
    { input: 0, output: 0, reasoning: 0, read: 0, write: 0 },
  )
  // One assistant message is one step. v1 weighted the speed by the active generation time of each step (step start
  // to step end), so tool runs and idle time between steps do not count.
  const steps = messages.flatMap((message) => {
    if (message.type !== "assistant" || !message.tokens || message.time.completed === undefined) return []
    const generated = message.tokens.output + message.tokens.reasoning
    const elapsed = message.time.completed - message.time.created
    return generated > 0 && elapsed > 0 ? [{ generated, elapsed }] : []
  })
  const generated = steps.reduce((total, step) => total + step.generated, 0)
  const elapsed = steps.reduce((total, step) => total + step.elapsed, 0)
  return { tokens, generation: elapsed > 0 ? (generated * 1000) / elapsed : undefined }
}

export function formatCount(value: number) {
  return count.format(value)
}

export function formatCost(value: number) {
  return currency.format(Math.max(0, Number.isFinite(value) ? value : 0))
}

export function formatCacheRate(tokens: { input: number; read: number; write: number }) {
  const total = tokens.input + tokens.read + tokens.write
  if (total === 0) return "-"
  return `${((tokens.read / total) * 100).toFixed(1)}%`
}

export function formatSpeed(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return "-"
  return `${rate.format(value)} t/s`
}

function period(value: ProviderUsage.UsagePeriod) {
  if (value.unit === "hour") return `${value.value}-hour quota`
  if (value.value === 1)
    return value.unit === "day" ? "Daily quota" : value.unit === "week" ? "Weekly quota" : "Monthly quota"
  return `${value.value}-${value.unit} quota`
}

export function windowLabel(window: ProviderUsage.UsageWindow) {
  const phrase = window.period ? period(window.period) : "Quota"
  // Plan-level windows ("subscription") are the whole card; named resources prefix theirs.
  if (window.resource === "subscription") return phrase
  return `${window.resource === "general" ? "Shared" : window.resource} · ${phrase}`
}

const number = (value: number) => value.toLocaleString("en-US", { maximumFractionDigits: 2 })

const amount = (value: number, unit: string) => {
  if (unit === "USD") return `$${value.toFixed(2)}`
  if (unit === "percent") return `${number(value)}%`
  if (unit === "count") return number(value)
  return `${number(value)} ${unit}`
}

export function formatWindow(window: ProviderUsage.UsageWindow) {
  if (window.state === "unlimited") return "Unlimited"
  if (window.state === "not_in_plan") return "Not in plan"
  if (window.state === "unknown") return "Unknown"
  if (window.orientation === "used_percent" && window.used !== undefined) return `${number(window.used)}% used`
  if (window.orientation === "remaining_percent" && window.remaining !== undefined)
    return `${number(window.remaining)}% remaining`
  if (window.remaining !== undefined && window.limit !== undefined)
    return `${amount(window.remaining, window.unit)} of ${amount(window.limit, window.unit)} remaining`
  if (window.used !== undefined && window.limit !== undefined)
    return `${amount(window.used, window.unit)} of ${amount(window.limit, window.unit)} used`
  return window.state === "exhausted" ? "Exhausted" : "Unknown"
}
