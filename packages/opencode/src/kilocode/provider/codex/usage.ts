import { InstallationVersion } from "@opencode-ai/core/installation/version"
import type { Info as AuthInfo } from "@/auth"
import type { UsageCredit, UsageSnapshot, UsageWindow } from "@/kilocode/provider-usage/schema"
import type { Info as ProviderInfo } from "@/provider/provider"
import { decode, type Native, type RateLimit, type Window } from "./native"

const url = "https://chatgpt.com/backend-api/wham/usage"
const manage = "https://chatgpt.com/codex/settings/usage"
const timeout = 5_000
const limit = 128 * 1024
type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export class CodexUsageError extends Error {
  constructor(readonly code: "network" | "auth" | "http" | "too_large" | "invalid") {
    super(code === "auth" ? "ChatGPT authentication is unavailable." : "Codex usage is temporarily unavailable.")
    this.name = "CodexUsageError"
  }
}

async function text(response: Response) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > limit) {
    response.body?.cancel().catch(() => undefined)
    throw new CodexUsageError("too_large")
  }
  if (!response.body) {
    const body = await response.arrayBuffer()
    if (body.byteLength > limit) throw new CodexUsageError("too_large")
    return new TextDecoder().decode(body)
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
      throw new CodexUsageError("too_large")
    }
    chunks.push(chunk.value)
  }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(body)
}

export async function query(fetcher: Fetcher): Promise<Native> {
  const response = await fetcher(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": `kilocode/${InstallationVersion}`,
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(timeout),
  }).catch(() => {
    throw new CodexUsageError("network")
  })
  if (response.status === 401 || response.status === 403) {
    response.body?.cancel().catch(() => undefined)
    throw new CodexUsageError("auth")
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => undefined)
    throw new CodexUsageError("http")
  }
  const body = await text(response)
  try {
    return decode(JSON.parse(body))
  } catch {
    throw new CodexUsageError("invalid")
  }
}

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

function label(name: string, window: Window, slot: "primary" | "secondary") {
  const minutes = window.limit_window_seconds === undefined ? undefined : window.limit_window_seconds / 60
  const suffix = minutes === 300 ? "5-hour" : minutes === 10_080 ? "weekly" : `${slot} window`
  return name === "Codex" ? `Codex ${suffix}` : `${name} ${suffix}`
}

function reset(value: number | undefined, after: number | undefined, fetchedAt: string) {
  if (value !== undefined && value > 0) return new Date(value * 1000).toISOString()
  if (after !== undefined && after > 0) return new Date(Date.parse(fetchedAt) + after * 1000).toISOString()
  return undefined
}

function windows(name: string, rate: RateLimit | undefined, fetchedAt: string): UsageWindow[] {
  if (!rate) return []
  return (
    [
      ["primary", rate.primary_window],
      ["secondary", rate.secondary_window],
    ] as const
  ).flatMap(([slot, window]) => {
    if (!window) return []
    const resetAt = reset(window.reset_at, window.reset_after_seconds, fetchedAt)
    return [
      {
        id: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${slot}`,
        label: label(name, window, slot),
        resource: name,
        kind: "quota" as const,
        unit: "percent",
        orientation: "used_percent" as const,
        used: window.used_percent,
        remaining: Math.max(0, 100 - window.used_percent),
        limit: 100,
        ...(window.limit_window_seconds !== undefined ? { durationMs: window.limit_window_seconds * 1000 } : {}),
        ...(resetAt ? { resetAt } : {}),
        state:
          rate.allowed === false || rate.limit_reached || window.used_percent >= 100
            ? ("exhausted" as const)
            : ("active" as const),
      },
    ]
  })
}

function credits(native: Native): UsageCredit[] {
  if (!native.credits) return []
  if (native.credits.unlimited) return [{ id: "purchased-credits", label: "Purchased credits", unlimited: true }]
  const balance = native.credits.balance
  return [
    {
      id: "purchased-credits",
      label: native.credits.overage_limit_reached ? "Purchased credits (limit reached)" : "Purchased credits",
      ...(balance !== undefined && balance !== null ? { balance: String(balance), unit: "credits" } : {}),
    },
  ]
}

export function normalize(native: Native): UsageSnapshot {
  const fetchedAt = new Date().toISOString()
  const general = windows("Codex", native.rate_limit, fetchedAt)
  const additional = native.additional_rate_limits.flatMap((item) =>
    windows(item.limit_name ?? item.metered_feature ?? "Additional quota", item.rate_limit ?? undefined, fetchedAt),
  )
  const quota = [...general, ...additional]
  const spendReported =
    native.spend_control?.reached === true ||
    (native.spend_control?.individual_limit !== undefined && native.spend_control.individual_limit !== null) ||
    native.credits?.overage_limit_reached === true
  const spend: UsageWindow[] = spendReported
    ? [
        {
          id: "spend-control",
          label: "Spend control",
          resource: "Purchased credits",
          kind: "spend_control",
          unit: "credits",
          orientation: "amount",
          ...(native.spend_control?.individual_limit !== undefined && native.spend_control.individual_limit !== null
            ? { limit: native.spend_control.individual_limit }
            : {}),
          state: native.spend_control?.reached || native.credits?.overage_limit_reached ? "exhausted" : "active",
        },
      ]
    : []
  const plan = native.plan_type ? (plans[native.plan_type] ?? `ChatGPT ${native.plan_type}`) : "ChatGPT Codex"
  return {
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "codex",
    providerLabel: "OpenAI",
    planLabel: plan,
    sourceLabel: "ChatGPT OAuth",
    fetchState: "ready",
    planState: "active",
    routingState: "not_applicable",
    availabilityState:
      native.rate_limit?.allowed === false || native.rate_limit?.limit_reached
        ? "exhausted"
        : quota.some((item) => item.state === "active")
          ? "available"
          : quota.some((item) => item.state === "exhausted")
            ? "exhausted"
            : "unknown",
    fetchedAt,
    confidence: "high",
    source: "provider_backend",
    managementUrl: manage,
    windows: [...quota, ...spend],
    balances: [],
    credits: credits(native),
  }
}

function unavailable(code: CodexUsageError["code"]): UsageSnapshot {
  return {
    id: "codex-chatgpt",
    providerID: "openai",
    sourceKind: "codex",
    providerLabel: "OpenAI",
    planLabel: "ChatGPT Codex",
    sourceLabel: "ChatGPT OAuth",
    fetchState: "unavailable",
    planState: "unknown",
    routingState: "not_applicable",
    availabilityState: "unavailable",
    confidence: "high",
    source: "provider_backend",
    managementUrl: manage,
    windows: [],
    balances: [],
    credits: [],
    error: {
      code: code === "auth" ? "codex_auth_unavailable" : "codex_usage_unavailable",
      message: code === "auth" ? "Reconnect ChatGPT to view Codex usage." : "Usage unavailable.",
      retryable: code !== "auth",
    },
  }
}

export async function codex(auth: AuthInfo | undefined, providers: Record<string, ProviderInfo>) {
  const provider = providers.openai
  const fetcher = provider?.options.fetch
  if (auth?.type !== "oauth" || !provider || provider.source !== "custom" || typeof fetcher !== "function") return []
  return query(fetcher).then(
    (native) => [normalize(native)],
    (error) => [unavailable(error instanceof CodexUsageError ? error.code : "invalid")],
  )
}
