/**
 * memory-webview.ts (real-backend wiring, agent-A2-fix-memory-tab-url)
 *
 * Bridges webview messages from MemoryTab.tsx → Shiba Memory service via the
 * DaveAI Hub. Replaces the previous hard-coded
 *   const SHIBA_BASE = "http://host.docker.internal:18789"
 * which only resolved inside a Docker container — desktop VS Code webviews
 * always saw DNS failures and showed "disconnected" forever.
 *
 * URL resolution precedence (first non-empty wins):
 *   1. VS Code config `kilocode.updates.hubBaseUrl`
 *   2. VS Code config `daveai.hub.baseUrl`
 *   3. Default `https://hermes.daveai.tech`
 *
 * Authentication: bearer token from VS Code SecretStorage under
 *   `kilo-code.new.hub.adminToken`
 * Both the legacy `kilo-code.new.hermes.apiKey` and the env-var fallbacks
 * are still consulted so existing installs keep working.
 *
 * Hub-side path layout (see `src/webui/hub/routers/shiba_proxy.py` /
 * `routers/shiba.py` — both names exist in the wild):
 *
 *   GET    /api/shiba/status        → connection + health snapshot
 *   POST   /api/shiba/recall        → semantic recall by query
 *   POST   /api/shiba/list          → write history / entries (paginated)
 *   GET    /api/shiba/memories      → flat list view (alternate older path)
 *   POST   /api/shiba/write         → new memory entry
 *   GET    /api/shiba/permissions   → list agent permissions
 *   POST   /api/shiba/permissions   → set agent permission
 *   DELETE /api/shiba/permissions/:agentId
 *   POST   /api/shiba/diagnostics   → run end-to-end probe
 *   GET    /api/shiba/traces        → cross-agent recall traces
 *   DELETE /api/shiba/traces        → clear traces
 *   DELETE /api/shiba/history       → clear write history
 *
 * Older Hubs may not expose any of the `/api/shiba/*` paths yet — those
 * return 404, which we surface as an empty "no entries yet" state plus the
 * underlying error string in `lastError` so the user knows to upgrade their
 * Hub. This keeps the tab honest across local-dev / VPS / Docker contexts.
 *
 * Two parallel message contracts are supported in this file:
 *   • Legacy unprefixed messages used by the production `MemoryTab.tsx`:
 *       memoryGetStatus, memoryRecall, memoryGetHistory, memoryWrite,
 *       memoryAddPermission, memoryRemovePermission, memoryRunDiagnostics,
 *       memoryLoadRecallTraces, memoryClearRecallTraces,
 *       memoryClearWriteHistory.
 *   • New `memory.*` prefixed contract used by the staged `MemoryLivePanel`:
 *       memory.list, memory.recall.
 */

import * as vscode from "vscode"

// ─── Configuration constants ─────────────────────────────────────────────

/** Primary VS Code config key (kilocode auto-update tooling sets this). */
export const HUB_BASE_URL_PRIMARY = "kilocode.updates.hubBaseUrl"
/** Fallback VS Code config key (legacy DaveAI Hub setup). */
export const HUB_BASE_URL_FALLBACK = "daveai.hub.baseUrl"
/** Last-resort default (production Hub). */
export const HUB_BASE_URL_DEFAULT = "https://hermes.daveai.tech"
/** SecretStorage key for the Hub admin bearer token. */
export const HUB_ADMIN_TOKEN_SECRET = "kilo-code.new.hub.adminToken"
/** Legacy Hermes API key, also accepted as bearer (Shiba shares the gate). */
export const HERMES_API_KEY_SECRET = "kilo-code.new.hermes.apiKey"

const FETCH_TIMEOUT_MS = 15_000
const DIAGNOSTICS_TIMEOUT_MS = 30_000

// ─── Types ───────────────────────────────────────────────────────────────

export interface MemoryWebviewContext {
  /** Required so the bearer token can be loaded from SecretStorage. */
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
}

/** Legacy alias kept for callers that already destructure this shape. */
export type MemoryRealWebviewContext = MemoryWebviewContext

interface ShibaMemory {
  id: string
  project: string
  scope: "global" | "project" | "task"
  factType: string
  summary: string
  content: string
  traceRef: string
  timestamp: number
  agent?: string
}

interface ShibaRecallResult {
  query: string
  project: string
  results: Array<ShibaMemory & { relevanceScore: number; matchReason: string }>
  status: "success" | "empty" | "failed"
  timestamp: number
}

interface HubFetchResult<T> {
  ok: boolean
  status: number
  data?: T
  error?: string
}

// ─── URL / token resolution ──────────────────────────────────────────────

/**
 * Resolve the active Hub base URL from VS Code settings, with a documented
 * precedence chain. Trailing slashes are trimmed.
 */
export function resolveHubBaseUrl(): string {
  const readDotted = (dotted: string): string | undefined => {
    const lastDot = dotted.lastIndexOf(".")
    if (lastDot < 0) {
      const value = vscode.workspace.getConfiguration().get<string>(dotted)
      return value && value.trim().length > 0 ? value.trim() : undefined
    }
    const section = dotted.slice(0, lastDot)
    const property = dotted.slice(lastDot + 1)
    const value = vscode.workspace.getConfiguration(section).get<string>(property)
    return value && value.trim().length > 0 ? value.trim() : undefined
  }

  const primary = readDotted(HUB_BASE_URL_PRIMARY)
  if (primary) return primary.replace(/\/+$/, "")

  const fallback = readDotted(HUB_BASE_URL_FALLBACK)
  if (fallback) return fallback.replace(/\/+$/, "")

  return HUB_BASE_URL_DEFAULT.replace(/\/+$/, "")
}

/**
 * Pull the bearer token from SecretStorage. Tries the new
 * `kilo-code.new.hub.adminToken` slot first, then falls back to the legacy
 * `kilo-code.new.hermes.apiKey`, then env vars. Any non-empty trimmed value
 * is returned; otherwise `undefined`.
 */
export async function resolveHubBearer(
  ctx: vscode.ExtensionContext,
): Promise<string | undefined> {
  const tryRead = async (id: string): Promise<string | undefined> => {
    try {
      const v = await ctx.secrets.get(id)
      if (v && v.trim().length > 0) return v.trim()
    } catch {
      /* ignore */
    }
    return undefined
  }

  return (
    (await tryRead(HUB_ADMIN_TOKEN_SECRET)) ??
    (await tryRead(HERMES_API_KEY_SECRET)) ??
    (process.env.KILO_HUB_TOKEN && process.env.KILO_HUB_TOKEN.trim().length > 0
      ? process.env.KILO_HUB_TOKEN.trim()
      : undefined) ??
    (process.env.HERMES_API_KEY && process.env.HERMES_API_KEY.trim().length > 0
      ? process.env.HERMES_API_KEY.trim()
      : undefined) ??
    (process.env.MINIMAX_API_KEY && process.env.MINIMAX_API_KEY.trim().length > 0
      ? process.env.MINIMAX_API_KEY.trim()
      : undefined)
  )
}

/**
 * Build the full URL for a Hub-relative path. The path may or may not
 * include a leading slash; either way we end up with exactly one.
 */
export function buildHubUrl(path: string, baseUrl: string = resolveHubBaseUrl()): string {
  const cleanBase = baseUrl.replace(/\/+$/, "")
  const cleanPath = path.startsWith("/") ? path : `/${path}`
  return `${cleanBase}${cleanPath}`
}

// ─── Fetch helpers ───────────────────────────────────────────────────────

/**
 * Hub-aware fetch with AbortController timeout. Mirrors the pattern used
 * by `hermes-webview.ts` / `HubServicesService.ts`. Returns a structured
 * result rather than throwing, so individual handlers can map specific
 * status codes (e.g. 404) to graceful empty states.
 */
async function hubFetch<T = unknown>(
  ctx: vscode.ExtensionContext,
  path: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<HubFetchResult<T>> {
  const baseUrl = resolveHubBaseUrl()
  const token = await resolveHubBearer(ctx)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers: Record<string, string> = {
      "content-type": "application/json",
      ...((options.headers as Record<string, string> | undefined) ?? {}),
    }
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(buildHubUrl(path, baseUrl), {
      ...options,
      headers,
      signal: ctrl.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      return {
        ok: false,
        status: res.status,
        error: `Hub ${path} → HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}`,
      }
    }
    let data: T | undefined
    try {
      data = (await res.json()) as T
    } catch {
      data = undefined
    }
    return { ok: true, status: res.status, data }
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    clearTimeout(timer)
  }
}

/** Empty status payload used both on hard failure and on 404 (older Hub). */
function emptyStatusPayload(endpoint: string, lastError?: string): Record<string, unknown> {
  return {
    type: "memoryStatusLoaded",
    connection: {
      status: lastError ? "error" : "disconnected",
      endpoint,
      lastError,
    },
    connectionHistory: [],
    entryCount: 0,
    writeHistoryCount: 0,
    permissions: [],
    health: {
      status: "unavailable",
      lastSuccessfulWrite: null,
      lastSuccessfulRecall: null,
      errorRate: lastError ? 1 : 0,
      consecutiveFailures: lastError ? 1 : 0,
    },
  }
}

// ─── Message handler — legacy unprefixed contract ────────────────────────

// eslint-disable-next-line complexity
export async function handleMemoryWebviewMessage(
  msg: Record<string, unknown>,
  ctx: MemoryWebviewContext,
): Promise<boolean> {
  const baseUrl = resolveHubBaseUrl()

  switch (msg.type) {
    case "requestMemoryStatus":
    case "memoryGetStatus": {
      const result = await hubFetch<Record<string, unknown>>(
        ctx.extensionContext,
        "/api/shiba/status",
      )
      if (result.ok && result.data) {
        ctx.postMessage({ type: "memoryStatusLoaded", ...result.data })
      } else if (result.status === 404) {
        // Older Hub without the shiba proxy — show empty zero state, not red error.
        ctx.postMessage(
          emptyStatusPayload(
            baseUrl,
            "Hub does not expose /api/shiba/* — upgrade DaveAI Hub or set kilocode.updates.hubBaseUrl",
          ),
        )
      } else {
        ctx.postMessage(emptyStatusPayload(baseUrl, result.error))
      }
      return true
    }

    case "memoryRecall": {
      const result = await hubFetch<Record<string, unknown>>(
        ctx.extensionContext,
        "/api/shiba/recall",
        {
          method: "POST",
          body: JSON.stringify({
            query: msg.query,
            project: msg.project ?? "current",
          }),
        },
      )
      if (result.ok && result.data) {
        ctx.postMessage({ type: "memoryRecallResult", ...result.data })
      } else if (result.status === 404) {
        ctx.postMessage({
          type: "memoryRecallResult",
          status: "empty",
          results: [],
          query: msg.query ?? "",
          project: msg.project ?? "current",
          timestamp: Date.now(),
          lastError: "Hub does not expose /api/shiba/recall",
        })
      } else {
        ctx.postMessage({
          type: "memoryRecallResult",
          status: "failed",
          results: [],
          query: msg.query ?? "",
          project: msg.project ?? "current",
          timestamp: Date.now(),
          error: result.error,
        })
      }
      return true
    }

    case "memoryGetHistory":
    case "memoryListEntries": {
      // Both message names map to the same /api/shiba/list proxy.
      const result = await hubFetch<{ records?: unknown[]; entries?: unknown[] }>(
        ctx.extensionContext,
        "/api/shiba/list",
        {
          method: "POST",
          body: JSON.stringify({
            project: msg.project,
            scope: msg.scope,
            factType: msg.factType,
            limit: msg.limit ?? 200,
          }),
        },
      )
      if (result.ok && result.data) {
        const records = result.data.records ?? result.data.entries ?? []
        ctx.postMessage({ type: "memoryHistoryLoaded", records })
      } else if (result.status === 404) {
        // Older Hub: gracefully report empty list + the error string.
        ctx.postMessage({
          type: "memoryHistoryLoaded",
          records: [],
          lastError: "Hub does not expose /api/shiba/list — no entries yet",
        })
      } else {
        ctx.postMessage({
          type: "memoryHistoryLoaded",
          records: [],
          lastError: result.error,
        })
      }
      return true
    }

    case "memoryWrite": {
      const result = await hubFetch<Record<string, unknown>>(
        ctx.extensionContext,
        "/api/shiba/write",
        {
          method: "POST",
          body: JSON.stringify({
            summary: msg.summary,
            content: msg.content,
            factType: msg.factType,
            scope: msg.scope,
            project: msg.project,
          }),
        },
      )
      if (result.ok) {
        ctx.postMessage({ type: "memoryWriteResult", success: true, ...(result.data ?? {}) })
      } else {
        ctx.postMessage({
          type: "memoryWriteResult",
          success: false,
          error: result.error,
        })
      }
      return true
    }

    case "memoryAddPermission": {
      const set = await hubFetch(ctx.extensionContext, "/api/shiba/permissions", {
        method: "POST",
        body: JSON.stringify({ agentId: msg.agentId, scope: msg.scope ?? "project" }),
      })
      if (!set.ok) {
        ctx.postMessage({ type: "memoryError", error: set.error })
        return true
      }
      const list = await hubFetch<{ permissions?: unknown[] }>(
        ctx.extensionContext,
        "/api/shiba/permissions",
      )
      ctx.postMessage({
        type: "memoryPermissionsUpdated",
        permissions: list.ok ? list.data?.permissions ?? [] : [],
      })
      return true
    }

    case "memoryRemovePermission": {
      await hubFetch(
        ctx.extensionContext,
        `/api/shiba/permissions/${encodeURIComponent(msg.agentId as string)}`,
        { method: "DELETE" },
      )
      const list = await hubFetch<{ permissions?: unknown[] }>(
        ctx.extensionContext,
        "/api/shiba/permissions",
      )
      ctx.postMessage({
        type: "memoryPermissionsUpdated",
        permissions: list.ok ? list.data?.permissions ?? [] : [],
      })
      return true
    }

    case "memoryRunDiagnostics": {
      const result = await hubFetch<Record<string, unknown>>(
        ctx.extensionContext,
        "/api/shiba/diagnostics",
        { method: "POST" },
        DIAGNOSTICS_TIMEOUT_MS,
      )
      if (result.ok && result.data) {
        ctx.postMessage({ type: "memoryDiagnosticsResult", ...result.data })
      } else {
        ctx.postMessage({
          type: "memoryDiagnosticsResult",
          connectivity: false,
          writeTest: false,
          recallTest: false,
          latencyMs: 0,
          errors: [result.error ?? "diagnostics failed"],
        })
      }
      return true
    }

    case "memoryLoadRecallTraces":
    case "memoryGetRecallTraces": {
      const result = await hubFetch<{ traces?: unknown[] }>(
        ctx.extensionContext,
        "/api/shiba/traces",
      )
      if (result.ok && result.data) {
        ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: result.data.traces ?? [] })
      } else {
        // 404 + transport errors both render as "no traces yet".
        ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] })
      }
      return true
    }

    case "memoryClearRecallTraces": {
      await hubFetch(ctx.extensionContext, "/api/shiba/traces", { method: "DELETE" })
      ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] })
      return true
    }

    case "memoryClearWriteHistory": {
      await hubFetch(ctx.extensionContext, "/api/shiba/history", { method: "DELETE" })
      ctx.postMessage({ type: "memoryWriteHistoryLoaded", history: [] })
      return true
    }

    default:
      return false
  }
}

// ─── Message handler — `memory.*` prefixed contract (live panel) ─────────

/**
 * Handles the new prefixed `memory.list` / `memory.recall` messages used by
 * `MemoryLivePanel`. Responds with `memory.update` envelopes.
 */
export async function handleMemoryRealWebviewMessage(
  msg: Record<string, unknown>,
  ctx: MemoryRealWebviewContext,
): Promise<boolean> {
  const type = msg.type
  if (typeof type !== "string" || !type.startsWith("memory.")) return false

  switch (type) {
    case "memory.list": {
      const result = await hubFetch<{ memories?: ShibaMemory[]; entryCount?: number }>(
        ctx.extensionContext,
        "/api/shiba/memories",
      )
      if (result.ok && result.data) {
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "list",
            memories: result.data.memories ?? [],
            entryCount: result.data.entryCount ?? result.data.memories?.length ?? 0,
            loadedAt: Date.now(),
          },
        })
      } else if (result.status === 404) {
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "list",
            memories: [],
            entryCount: 0,
            error: "Hub does not expose /api/shiba/memories — no entries yet",
          },
        })
      } else {
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "list",
            memories: [],
            entryCount: 0,
            error: result.error,
          },
        })
      }
      return true
    }

    case "memory.recall": {
      const query = (msg.query as string | undefined)?.trim() ?? ""
      if (!query) {
        ctx.postMessage({
          type: "memory.update",
          payload: { kind: "recall", error: "query is required", results: [], status: "failed" },
        })
        return true
      }
      const result = await hubFetch<ShibaRecallResult>(
        ctx.extensionContext,
        "/api/shiba/recall",
        {
          method: "POST",
          body: JSON.stringify({ query, project: msg.project ?? "current" }),
        },
      )
      if (result.ok && result.data) {
        const data = result.data
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "recall",
            query: data.query,
            project: data.project,
            results: data.results ?? [],
            status: data.status ?? (data.results?.length ? "success" : "empty"),
            ts: Date.now(),
          },
        })
      } else if (result.status === 404) {
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "recall",
            query,
            results: [],
            status: "empty",
            error: "Hub does not expose /api/shiba/recall",
          },
        })
      } else {
        ctx.postMessage({
          type: "memory.update",
          payload: {
            kind: "recall",
            query,
            results: [],
            status: "failed",
            error: result.error,
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
export const __test = {
  HUB_BASE_URL_PRIMARY,
  HUB_BASE_URL_FALLBACK,
  HUB_BASE_URL_DEFAULT,
  HUB_ADMIN_TOKEN_SECRET,
  resolveHubBaseUrl,
  resolveHubBearer,
  buildHubUrl,
  hubFetch,
}
