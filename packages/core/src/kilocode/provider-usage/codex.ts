import type { ProviderUsage } from "@opencode-ai/schema/kilocode/provider-usage"

const url = "https://chatgpt.com/backend-api/wham/usage"
const manage = "https://chatgpt.com/codex/settings/usage"
const limit = 64 * 1024
const timeout = 5_000
const maximum = 8_640_000_000_000_000

const plans: Record<string, string> = {
  plus: "ChatGPT Plus",
  pro: "ChatGPT Pro",
  prolite: "ChatGPT Pro Lite",
  business: "ChatGPT Business",
  enterprise: "ChatGPT Enterprise",
  edu: "ChatGPT Edu",
  education: "ChatGPT Education",
  team: "ChatGPT Team",
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
  allowed?: boolean
  reached?: boolean
  primary?: Window
  secondary?: Window
}

interface Native {
  plan?: string
  rate?: Rate
  additional: { name: string; rate: Rate }[]
}

class Failure extends Error {
  constructor(readonly code: "network" | "auth" | "http" | "size" | "invalid") {
    super(code === "auth" ? "ChatGPT authentication is unavailable." : "Codex usage is unavailable.")
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
  return {
    allowed: typeof input.allowed === "boolean" ? input.allowed : undefined,
    reached: typeof input.limit_reached === "boolean" ? input.limit_reached : undefined,
    primary: window(input.primary_window),
    secondary: window(input.secondary_window),
  }
}

export function decode(input: unknown): Native {
  if (!object(input)) throw new Failure("invalid")
  const additional = Array.isArray(input.additional_rate_limits)
    ? input.additional_rate_limits.flatMap((item) => {
        if (!object(item)) return []
        const limit = rate(item.rate_limit)
        if (!limit) return []
        const name =
          typeof item.limit_name === "string" && item.limit_name.trim()
            ? item.limit_name.trim()
            : typeof item.metered_feature === "string" && item.metered_feature.trim()
              ? item.metered_feature.trim()
              : "Additional quota"
        return [{ name, rate: limit }]
      })
    : []
  return {
    plan: typeof input.plan_type === "string" && input.plan_type ? input.plan_type : undefined,
    rate: rate(input.rate_limit),
    additional,
  }
}

async function body(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => undefined)
    throw new Failure("size")
  }
  if (!response.body) {
    const value = await response.arrayBuffer()
    if (value.byteLength > limit) throw new Failure("size")
    return new TextDecoder().decode(value)
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  while (true) {
    const chunk = await reader.read()
    if (chunk.done) break
    if (!chunk.value) continue
    size += chunk.value.byteLength
    if (size > limit) {
      await reader.cancel().catch(() => undefined)
      throw new Failure("size")
    }
    chunks.push(chunk.value)
  }
  const value = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    value.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(value)
}

export async function query(candidate: Candidate, fetcher: typeof fetch = fetch): Promise<Native> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: `Bearer ${candidate.access}`,
  }
  if (candidate.account) headers["ChatGPT-Account-Id"] = candidate.account
  const response = await fetcher(url, {
    method: "GET",
    headers,
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => {
    throw new Failure("network")
  })
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined)
    throw new Failure(response.status === 401 || response.status === 403 ? "auth" : "http")
  }
  const text = await body(response)
  try {
    return decode(JSON.parse(text))
  } catch {
    throw new Failure("invalid")
  }
}

function reset(value: Window, now: number) {
  const direct = value.reset === undefined ? undefined : value.reset * 1000
  if (direct !== undefined && direct > 0 && direct <= maximum) return new Date(direct).toISOString()
  const offset = value.after === undefined ? undefined : value.after * 1000
  const relative = offset === undefined ? undefined : now + offset
  if (
    relative !== undefined &&
    offset !== undefined &&
    offset > 0 &&
    relative <= maximum &&
    Number.isSafeInteger(relative)
  ) {
    return new Date(relative).toISOString()
  }
  return undefined
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

function windows(name: string, rate: Rate | undefined, now: number, used: Map<string, number>) {
  if (!rate) return []
  const clean =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "quota"
  let count = (used.get(clean) ?? 0) + 1
  let slug = count === 1 ? clean : `${clean}-${count}`
  while (used.has(slug)) {
    count++
    slug = `${clean}-${count}`
  }
  used.set(clean, count)
  used.set(slug, 1)
  return (
    [
      ["primary", rate.primary],
      ["secondary", rate.secondary],
    ] as const
  ).flatMap(([slot, value]) => {
    if (!value) return []
    const exhausted = rate.allowed === false || rate.reached === true || value.used >= 100
    const percent = exhausted ? 100 : Math.min(100, Math.max(0, value.used))
    const duration =
      value.duration !== undefined && value.duration > 0 && Number.isSafeInteger(value.duration * 1000)
        ? value.duration
        : undefined
    return [
      {
        id: `${slug}-${slot}`,
        resource: name,
        unit: "percent",
        orientation: "used_percent",
        used: percent,
        remaining: 100 - percent,
        limit: 100,
        durationMs: duration === undefined ? undefined : duration * 1000,
        period: duration === undefined ? undefined : period(duration),
        resetAt: reset(value, now),
        state: exhausted ? "exhausted" : "active",
      } satisfies ProviderUsage.UsageWindow,
    ]
  })
}

export function normalize(native: Native, label = "OpenAI"): ProviderUsage.UsageSnapshot {
  const now = Date.now()
  const seen = new Map<string, number>()
  const main = windows("Codex", native.rate, now, seen)
  const additional = native.additional.flatMap((item) => windows(item.name, item.rate, now, seen))
  return {
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "direct",
    providerLabel: label,
    planLabel: native.plan ? (plans[native.plan.toLowerCase()] ?? `ChatGPT ${native.plan}`) : "ChatGPT Codex",
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

export function load(candidate: Candidate, fetcher: typeof fetch = fetch) {
  return query(candidate, fetcher)
    .then((native) => normalize(native, candidate.label))
    .catch((error) => unavailable(candidate.label, error instanceof Failure && error.code === "auth"))
}
