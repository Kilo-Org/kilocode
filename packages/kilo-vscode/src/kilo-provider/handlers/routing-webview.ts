/**
 * routing-webview.ts (real-backend wiring, agent-wire-tabs-real)
 *
 * Bridges webview messages from RoutingTab.tsx → LiteLLM proxy via the Hub.
 *
 * Backend endpoints (LiteLLM proxy is part of the Hub stack — commit b6f2969):
 *     GET  https://hermes.daveai.tech/api/litellm/models
 *     POST https://hermes.daveai.tech/api/litellm/route  { task, model? }
 *
 * Auth: same Hermes API key (Hub gate). LiteLLM master key stored
 * separately as an env var on the Hub side; the browser/host only knows the
 * Hub bearer.
 *
 * Message types handled (NEW prefixed style — `routing.<action>`):
 *   routing.listModels → GET  /api/litellm/models
 *   routing.route      → POST /api/litellm/route
 *
 * Host responds with `{ type: "routing.update", payload: { kind, ... } }`.
 *
 * NOTE: this handler is ADDITIVE — the existing routing service still owns
 * provider registry, role matrix, traces, health summary. This handler ONLY
 * provides the live model list + route-decision endpoint, which the existing
 * RoutingService cannot deliver because it has no upstream introspection
 * source.
 */

import * as vscode from "vscode"

const HUB_BASE = process.env.KILO_HUB_BASE ?? "https://hermes.daveai.tech"
const HERMES_KEY_ID = "kilo-code.new.hermes.apiKey"
const FETCH_TIMEOUT_MS = 15_000

export interface RoutingRealWebviewContext {
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
}

interface LiteLLMModel {
  id: string
  provider: string
  context_window?: number
  cost_per_1k_input?: number
  cost_per_1k_output?: number
  capabilities?: string[]
  status?: "healthy" | "degraded" | "offline"
}

interface RouteDecisionResponse {
  selected: string
  reason: string
  fallback?: string[]
  estimated_cost_usd?: number
  trace?: Array<{ step: string; provider?: string; result: string; reason: string }>
}

async function readApiKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await ctx.secrets.get(HERMES_KEY_ID)
  if (stored && stored.length > 0) return stored
  return process.env.HERMES_API_KEY ?? process.env.MINIMAX_API_KEY
}

async function litellmFetch<T>(
  ctx: vscode.ExtensionContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const apiKey = await readApiKey(ctx)
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...((init.headers as Record<string, string>) ?? {}),
    }
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`
    const res = await fetch(`${HUB_BASE}${path}`, { ...init, signal: ctrl.signal, headers })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`LiteLLM ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function handleRoutingRealWebviewMessage(
  msg: Record<string, unknown>,
  ctx: RoutingRealWebviewContext,
): Promise<boolean> {
  const type = msg.type
  if (typeof type !== "string" || !type.startsWith("routing.")) return false

  switch (type) {
    case "routing.listModels": {
      try {
        const data = await litellmFetch<{ data: LiteLLMModel[] } | { models: LiteLLMModel[] }>(
          ctx.extensionContext,
          "/api/litellm/models",
        )
        const models =
          (data as { data?: LiteLLMModel[] }).data ?? (data as { models?: LiteLLMModel[] }).models ?? []
        ctx.postMessage({
          type: "routing.update",
          payload: { kind: "models", models, loadedAt: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "routing.update",
          payload: { kind: "models", models: [], error: e instanceof Error ? e.message : String(e) },
        })
      }
      return true
    }

    case "routing.route": {
      const task = (msg.task as string | undefined)?.trim() ?? ""
      if (!task) {
        ctx.postMessage({
          type: "routing.update",
          payload: { kind: "route", error: "task is required" },
        })
        return true
      }
      const body: Record<string, unknown> = { task }
      if (typeof msg.model === "string") body.model = msg.model
      if (msg.constraints) body.constraints = msg.constraints
      try {
        const data = await litellmFetch<RouteDecisionResponse>(ctx.extensionContext, "/api/litellm/route", {
          method: "POST",
          body: JSON.stringify(body),
        })
        ctx.postMessage({
          type: "routing.update",
          payload: { kind: "route", request: body, response: data, ts: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "routing.update",
          payload: {
            kind: "route",
            request: body,
            error: e instanceof Error ? e.message : String(e),
          },
        })
      }
      return true
    }

    default:
      return false
  }
}

// Exported for tests
export const __test = { HUB_BASE, HERMES_KEY_ID, litellmFetch }
