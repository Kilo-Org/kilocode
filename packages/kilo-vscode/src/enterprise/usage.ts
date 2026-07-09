import * as vscode from "vscode"
import { TelemetryEventName } from "../services/telemetry/types"
import { gatekeeperSettings } from "../gatekeeper/settings"
import { getToken } from "../gatekeeper/auth"

export type UsageEvent = {
  ide: "vscode" | "jetbrains" | "android"
  occurred_at: string
  event: string
  metrics: Record<string, number | string>
}

type Sink = {
  platform: string
  token: string
}

let sink: Sink | null = null
const queue: UsageEvent[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null

const WRITE_TOOLS = new Set(["write", "edit", "patch", "multiedit", "apply_patch"])

export function configureEnterpriseUsage(next: Sink | null) {
  sink = next
  if (next && queue.length > 0) {
    void flush()
  }
}

export async function refreshEnterpriseUsage(context: vscode.ExtensionContext): Promise<void> {
  const cfg = gatekeeperSettings()
  const token = (await getToken(context))?.trim() ?? ""
  const platform = cfg.platform.trim()
  if (!platform || !token) {
    configureEnterpriseUsage(null)
    return
  }
  configureEnterpriseUsage({ platform, token })
}

export async function enterpriseUsageEnv(context: vscode.ExtensionContext): Promise<Record<string, string>> {
  const cfg = gatekeeperSettings()
  const token = (await getToken(context))?.trim() ?? ""
  const platform = cfg.platform.trim()
  if (!platform || !token) return {}
  return {
    KILO_ENTERPRISE_PLATFORM_URL: platform,
    KILO_ENTERPRISE_USAGE_TOKEN: token,
  }
}

export function captureEnterpriseUsage(event: string, props?: Record<string, unknown>) {
  const mapped = mapTelemetry(event, props)
  if (!mapped) return
  enqueue(mapped)
}

export function postEnterpriseUsage(event: UsageEvent) {
  enqueue(event)
}

function enqueue(item: UsageEvent) {
  if (!sink) {
    queue.push(item)
    if (queue.length > 200) queue.shift()
    return
  }
  queue.push(item)
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, 500)
  }
}

async function flush() {
  const active = sink
  if (!active || queue.length === 0) return
  const batch = queue.splice(0, 100)
  try {
    const res = await fetch(`${active.platform}/api/v1/usage/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${active.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ events: batch }),
    })
    if (!res.ok) {
      console.warn("[enterprise-usage] post failed:", res.status, await res.text())
      queue.unshift(...batch)
    }
  } catch (err) {
    console.warn("[enterprise-usage] post error:", err)
    queue.unshift(...batch)
  }
  if (queue.length > 0 && sink) {
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, 500)
  }
}

function mapTelemetry(event: string, props?: Record<string, unknown>): UsageEvent | null {
  const base = {
    ide: "vscode" as const,
    occurred_at: new Date().toISOString(),
    metrics: {} as Record<string, number | string>,
  }

  switch (event) {
    case TelemetryEventName.AUTOCOMPLETE_UNIQUE_SUGGESTION_SHOWN:
    case TelemetryEventName.AUTOCOMPLETE_SUGGESTION_CACHE_HIT:
      return { ...base, event: "completion.suggested" }
    case TelemetryEventName.AUTOCOMPLETE_LLM_SUGGESTION_RETURNED:
      if (props?.shown !== true) return null
      return { ...base, event: "completion.suggested" }
    case TelemetryEventName.AUTOCOMPLETE_ACCEPT_SUGGESTION: {
      const len = metricNum(props, "suggestionLength") || metricNum(props, "length")
      return {
        ...base,
        event: "completion.accepted",
        metrics: { chars: len, lines: Math.max(1, len > 0 ? 1 : 0) || 1 },
      }
    }
    case TelemetryEventName.AUTOCOMPLETE_LLM_REQUEST_COMPLETED:
    case TelemetryEventName.LLM_COMPLETION:
      return {
        ...base,
        event: "llm.tokens",
        metrics: {
          input: metricNum(props, "inputTokens") || metricNum(props, "input"),
          output: metricNum(props, "outputTokens") || metricNum(props, "output"),
        },
      }
    case TelemetryEventName.INLINE_ASSIST_AUTO_TASK:
      return {
        ...base,
        event: "inline.accepted",
        metrics: { chars: metricNum(props, "chars") },
      }
    case TelemetryEventName.TOOL_USED: {
      const tool = String(props?.tool ?? props?.toolName ?? "").toLowerCase()
      if (!WRITE_TOOLS.has(tool)) return null
      const path = String(props?.path ?? props?.file ?? "")
      return { ...base, event: "agent.file.edited", metrics: { path } }
    }
    default:
      if (event === "LLM Completion") {
        return {
          ...base,
          event: "llm.tokens",
          metrics: {
            input: metricNum(props, "inputTokens") || metricNum(props, "input"),
            output: metricNum(props, "outputTokens") || metricNum(props, "output"),
          },
        }
      }
      if (event === "Tool Used") {
        const tool = String(props?.tool ?? props?.toolName ?? "").toLowerCase()
        if (!WRITE_TOOLS.has(tool)) return null
        const path = String(props?.path ?? props?.file ?? "")
        return { ...base, event: "agent.file.edited", metrics: { path } }
      }
      return null
  }
}

function metricNum(props: Record<string, unknown> | undefined, key: string): number {
  const v = props?.[key]
  if (typeof v === "number" && Number.isFinite(v)) return v
  if (typeof v === "string") {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return 0
}
