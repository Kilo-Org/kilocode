/**
 * hermes-webview.ts (real-backend wiring, agent-wire-tabs-real)
 *
 * Bridges webview messages from HermesTab.tsx → Hermes router (Hub).
 *
 * Pattern: mirrors Speech (SettingsEditorProvider.ts uses postMessage +
 * azureKeyValidationResult round-trip; here we round-trip via
 * `hermes.update` payloads).
 *
 * Backend: Hermes router lives behind the Hub at:
 *     GET  https://hermes.daveai.tech/hermes/agents
 *     POST https://hermes.daveai.tech/hermes/route
 *
 * Both endpoints exist in production today (Hermes Router service shipped in
 * commit ca5d8f0 — `hermes-router` container exposes /hermes/* on the Hub).
 *
 * Auth: Bearer token from VS Code SecretStorage under key
 *     "kilo-code.new.hermes.apiKey"
 * Falls back to env var HERMES_API_KEY (matches existing
 * services/hermes/secrets.ts contract).
 *
 * Message types handled (NEW prefixed style — `hermes.<action>`):
 *   hermes.listAgents → GET  /hermes/agents
 *   hermes.route      → POST /hermes/route { task, agent? }
 *
 * The host responds with `{ type: "hermes.update", payload }` for both
 * success and failure (payload.error set on failure).
 *
 * NOTE: existing handler keeps `requestHermesStatus`/etc; this handler is
 * registered alongside in the dave overlay so legacy Hermes tab buttons
 * still work.
 */

import * as vscode from "vscode"

const HUB_BASE = process.env.KILO_HUB_BASE ?? "https://hermes.daveai.tech"
const HERMES_KEY_ID = "kilo-code.new.hermes.apiKey"
const FETCH_TIMEOUT_MS = 15_000

export interface HermesRealWebviewContext {
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
}

interface HermesAgent {
  id: string
  name: string
  description?: string
  capabilities?: string[]
  status?: string
}

interface HermesRouteRequest {
  task: string
  agent?: string
  context?: Record<string, unknown>
}

interface HermesRouteResponse {
  agent: string
  output: string
  trace?: unknown[]
  cost_usd?: number
}

async function readApiKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await ctx.secrets.get(HERMES_KEY_ID)
  if (stored && stored.length > 0) return stored
  return process.env.HERMES_API_KEY ?? process.env.MINIMAX_API_KEY
}

async function hermesFetch<T>(
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

    const res = await fetch(`${HUB_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Hermes ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Returns true if the message was consumed.
 *
 * Caller should invoke this BEFORE the legacy `requestHermesStatus` switch
 * — only `hermes.*` typed messages are handled here.
 */
export async function handleHermesRealWebviewMessage(
  msg: Record<string, unknown>,
  ctx: HermesRealWebviewContext,
): Promise<boolean> {
  const type = msg.type
  if (typeof type !== "string" || !type.startsWith("hermes.")) return false

  switch (type) {
    case "hermes.listAgents": {
      try {
        const data = await hermesFetch<{ agents: HermesAgent[] }>(ctx.extensionContext, "/hermes/agents")
        ctx.postMessage({
          type: "hermes.update",
          payload: { kind: "agents", agents: data.agents ?? [], loadedAt: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "hermes.update",
          payload: { kind: "agents", agents: [], error: e instanceof Error ? e.message : String(e) },
        })
      }
      return true
    }

    case "hermes.route": {
      const body: HermesRouteRequest = {
        task: (msg.task as string) ?? "",
        agent: msg.agent as string | undefined,
        context: msg.context as Record<string, unknown> | undefined,
      }
      if (!body.task) {
        ctx.postMessage({
          type: "hermes.update",
          payload: { kind: "route", error: "task is required" },
        })
        return true
      }
      try {
        const data = await hermesFetch<HermesRouteResponse>(ctx.extensionContext, "/hermes/route", {
          method: "POST",
          body: JSON.stringify(body),
        })
        ctx.postMessage({
          type: "hermes.update",
          payload: {
            kind: "route",
            request: body,
            response: data,
            ts: Date.now(),
          },
        })
      } catch (e) {
        ctx.postMessage({
          type: "hermes.update",
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
export const __test = { HUB_BASE, HERMES_KEY_ID, hermesFetch }
