export * as CodexUsage from "./codex"

import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { get, text } from "./http"

// ChatGPT Codex rate limits of an OpenAI connection signed in with ChatGPT OAuth. Same request and mapping as v1
// (packages/core/src/kilocode/provider-usage/codex.ts on main).
const url = "https://chatgpt.com/backend-api/wham/usage"
const manage = "https://chatgpt.com/codex/settings/usage"
const maximum = 8_640_000_000_000_000

const plans: Record<string, string> = {
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  prolite: "ChatGPT Pro Lite",
  business: "ChatGPT Enterprise",
  self_serve_business_prolite: "ChatGPT Business Premium",
  self_serve_business_usage_based: "ChatGPT Business",
  ent26: "ChatGPT Enterprise",
  enterprise_cbp_automation: "ChatGPT Enterprise (Automation)",
  enterprise_cbp_usage_based: "ChatGPT Enterprise",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
  education: "ChatGPT Edu",
  edu_plus: "ChatGPT Edu Plus",
  edu_pro: "ChatGPT Edu Pro",
  team: "ChatGPT Business",
  free: "ChatGPT Free",
  go: "ChatGPT Go",
}

export interface Candidate {
  label: string
  access: string
  account?: string
}

interface Window {
  used: number
  duration?: number
  reset?: number
  after?: number
}

interface Rate {
  primary?: Window
  secondary?: Window
}

interface Native {
  plan?: string
  rate?: Rate
  additional: { id: string; name: string; rate: Rate }[]
}

class Failure extends Error {
  constructor(readonly code: "network" | "auth" | "http" | "invalid") {
    super(code === "auth" ? "ChatGPT authentication is unavailable." : "Codex usage is unavailable.")
  }
}

export function load(candidate: Candidate, fetcher: typeof fetch = fetch) {
  return query(candidate, fetcher)
    .then((native) => normalize(native, candidate.label))
    .catch((error) => unavailable(candidate.label, error instanceof Failure && error.code === "auth"))
}

async function query(candidate: Candidate, fetcher: typeof fetch): Promise<Native> {
  const headers: Record<string, string> = { Authorization: `Bearer ${candidate.access}` }
  if (candidate.account) headers["ChatGPT-Account-Id"] = candidate.account
  const response = await get(url, headers, fetcher).catch(() => {
    throw new Failure("network")
  })
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined)
    throw new Failure(response.status === 401 || response.status === 403 ? "auth" : "http")
  }
  const body = await text(response).catch(() => {
    throw new Failure("invalid")
  })
  try {
    return decode(JSON.parse(body))
  } catch {
    throw new Failure("invalid")
  }
}

export function decode(input: unknown): Native {
  if (!object(input) || typeof input.plan_type !== "string" || !input.plan_type.trim()) throw new Failure("invalid")
  if (input.additional_rate_limits != null && !Array.isArray(input.additional_rate_limits)) throw new Failure("invalid")
  const entries: unknown[] = input.additional_rate_limits ?? []
  const main = rate(input.rate_limit)
  const additional = entries.flatMap((item) => {
    if (!object(item)) return []
    const limit = rate(item.rate_limit)
    if (!limit) return []
    const feature = typeof item.metered_feature === "string" ? item.metered_feature.trim() : ""
    const name =
      typeof item.limit_name === "string" && item.limit_name.trim()
        ? item.limit_name.trim()
        : feature || "Additional quota"
    return [{ id: feature || name, name, rate: limit }]
  })
  const supplied = [input.rate_limit, ...entries.map((item) => (object(item) ? item.rate_limit : item))]
  if (
    !main?.primary &&
    !main?.secondary &&
    !additional.some((item) => item.rate.primary || item.rate.secondary) &&
    supplied.some(
      (value) => value != null && (!object(value) || value.primary_window != null || value.secondary_window != null),
    )
  )
    throw new Failure("invalid")
  return { plan: input.plan_type, rate: main, additional }
}

export function normalize(native: Native, label = "OpenAI"): ProviderUsage.UsageSnapshot {
  const now = Date.now()
  const seen = new Map<string, number>()
  const main = windows("codex", "Codex", native.rate, now)
  const additional = native.additional.flatMap((item) => {
    const count = seen.get(item.id) ?? 0
    seen.set(item.id, count + 1)
    return windows(JSON.stringify(["additional", item.id, count]), item.name, item.rate, now)
  })
  // A plan type such as "constructor" must not resolve to an Object.prototype member.
  const plan = plans[native.plan?.toLowerCase() ?? ""]
  return {
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "direct",
    providerLabel: label,
    planLabel: typeof plan === "string" ? plan : "ChatGPT Codex",
    sourceLabel: "ChatGPT OAuth",
    fetchState: "ready",
    planState: "active",
    routingState: "not_applicable",
    fetchedAt: new Date(now).toISOString(),
    managementUrl: manage,
    windows: [...main, ...additional],
  }
}

function unavailable(label: string, auth: boolean): ProviderUsage.UsageSnapshot {
  return {
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "direct",
    providerLabel: label,
    planLabel: "ChatGPT Codex",
    sourceLabel: "ChatGPT OAuth",
    fetchState: "unavailable",
    planState: "unknown",
    routingState: "not_applicable",
    managementUrl: manage,
    windows: [],
    error: {
      code: auth ? "codex_auth_unavailable" : "codex_usage_unavailable",
      message: auth ? "Reconnect ChatGPT to view Codex usage." : "Usage unavailable.",
      retryable: !auth,
    },
  }
}

function object(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function number(input: unknown) {
  return typeof input === "number" && Number.isFinite(input) ? input : undefined
}

function window(input: unknown): Window | undefined {
  if (!object(input)) return undefined
  const used = number(input.used_percent)
  if (used === undefined) return undefined
  return {
    used,
    duration: number(input.limit_window_seconds),
    reset: number(input.reset_at),
    after: number(input.reset_after_seconds),
  }
}

function rate(input: unknown): Rate | undefined {
  if (!object(input)) return undefined
  return { primary: window(input.primary_window), secondary: window(input.secondary_window) }
}

function reset(value: Window, now: number) {
  const direct = value.reset === undefined ? undefined : value.reset * 1000
  if (direct !== undefined && direct > 0 && direct <= maximum) return new Date(direct).toISOString()
  const offset = value.after === undefined ? undefined : value.after * 1000
  const relative = offset === undefined ? undefined : now + offset
  if (relative === undefined || offset === undefined || offset <= 0) return undefined
  if (relative > maximum || !Number.isSafeInteger(relative)) return undefined
  return new Date(relative).toISOString()
}

function period(duration: number): ProviderUsage.UsagePeriod | undefined {
  for (const [unit, seconds] of [
    ["week", 604_800],
    ["day", 86_400],
    ["hour", 3_600],
  ] as const) {
    if (duration % seconds === 0) return { unit, value: duration / seconds }
  }
  return undefined
}

function windows(id: string, name: string, rate: Rate | undefined, now: number): ProviderUsage.UsageWindow[] {
  if (!rate) return []
  return (
    [
      ["primary", rate.primary],
      ["secondary", rate.secondary],
    ] as const
  ).flatMap(([slot, value]) => {
    if (!value) return []
    const percent = Math.min(100, Math.max(0, value.used))
    const duration =
      value.duration !== undefined && value.duration > 0 && Number.isSafeInteger(value.duration * 1000)
        ? value.duration
        : undefined
    return [
      {
        id: `${id}-${slot}`,
        resource: name,
        unit: "percent",
        orientation: "used_percent",
        used: percent,
        remaining: 100 - percent,
        limit: 100,
        durationMs: duration === undefined ? undefined : duration * 1000,
        period: duration === undefined ? undefined : period(duration),
        resetAt: reset(value, now),
        state: percent === 100 ? "exhausted" : "active",
      },
    ]
  })
}
