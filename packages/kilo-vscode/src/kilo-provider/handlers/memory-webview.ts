/**
 * memory-webview.ts
 *
 * Bridges webview messages from MemoryTab.tsx → Shiba Memory HTTP API.
 *
 * Shiba Memory endpoint: http://host.docker.internal:18789
 *
 * Message types handled:
 *   requestMemoryStatus      → GET /status, push memoryStatusLoaded
 *   memoryRecall             → POST /recall, push memoryRecallResult
 *   memoryWrite              → POST /write, push memoryWriteResult
 *   memoryAddPermission      → POST /permissions, push memoryPermissionsUpdated
 *   memoryRemovePermission   → DELETE /permissions/:agentId, push memoryPermissionsUpdated
 *   memoryRunDiagnostics     → POST /diagnostics, push memoryDiagnosticsResult
 *   memoryLoadRecallTraces   → GET /traces, push memoryRecallTracesLoaded
 *   memoryClearRecallTraces  → DELETE /traces, push memoryRecallTracesLoaded (empty)
 *   memoryClearWriteHistory  → DELETE /history, push memoryWriteHistoryLoaded (empty)
 */

const SHIBA_BASE = "http://host.docker.internal:18789"
const FETCH_TIMEOUT_MS = 10_000

export interface MemoryWebviewContext {
  postMessage: (msg: unknown) => void
}

async function shibaFetch(
  path: string,
  options: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${SHIBA_BASE}${path}`, {
      ...options,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(options.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Shiba ${path} → HTTP ${res.status}: ${body}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// eslint-disable-next-line complexity
export async function handleMemoryWebviewMessage(
  msg: Record<string, unknown>,
  ctx: MemoryWebviewContext,
): Promise<boolean> {
  switch (msg.type) {
    case "requestMemoryStatus": {
      try {
        const data = await shibaFetch("/status")
        ctx.postMessage({ type: "memoryStatusLoaded", ...(data as object) })
      } catch (e) {
        ctx.postMessage({
          type: "memoryStatusLoaded",
          connection: {
            status: "error",
            endpoint: SHIBA_BASE,
            lastError: e instanceof Error ? e.message : String(e),
          },
          connectionHistory: [],
          entryCount: 0,
          writeHistoryCount: 0,
          permissions: [],
          health: {
            status: "unavailable",
            lastSuccessfulWrite: null,
            lastSuccessfulRecall: null,
            errorRate: 1,
            consecutiveFailures: 1,
          },
        })
      }
      return true
    }

    case "memoryRecall": {
      try {
        const data = await shibaFetch("/recall", {
          method: "POST",
          body: JSON.stringify({
            query: msg.query,
            project: msg.project ?? "current",
          }),
        })
        ctx.postMessage({ type: "memoryRecallResult", ...(data as object) })
      } catch (e) {
        ctx.postMessage({
          type: "memoryRecallResult",
          status: "failed",
          results: [],
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return true
    }

    case "memoryWrite": {
      try {
        const data = await shibaFetch("/write", {
          method: "POST",
          body: JSON.stringify({
            summary: msg.summary,
            content: msg.content,
            factType: msg.factType,
            scope: msg.scope,
            project: msg.project,
          }),
        })
        ctx.postMessage({ type: "memoryWriteResult", success: true, ...(data as object) })
      } catch (e) {
        ctx.postMessage({
          type: "memoryWriteResult",
          success: false,
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return true
    }

    case "memoryAddPermission": {
      try {
        await shibaFetch("/permissions", {
          method: "POST",
          body: JSON.stringify({ agentId: msg.agentId, scope: msg.scope ?? "project" }),
        })
        const perms = await shibaFetch("/permissions")
        ctx.postMessage({ type: "memoryPermissionsUpdated", permissions: (perms as { permissions: unknown[] }).permissions ?? [] })
      } catch (e) {
        ctx.postMessage({
          type: "memoryError",
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return true
    }

    case "memoryRemovePermission": {
      try {
        await shibaFetch(`/permissions/${encodeURIComponent(msg.agentId as string)}`, { method: "DELETE" })
        const perms = await shibaFetch("/permissions")
        ctx.postMessage({ type: "memoryPermissionsUpdated", permissions: (perms as { permissions: unknown[] }).permissions ?? [] })
      } catch (e) {
        ctx.postMessage({
          type: "memoryError",
          error: e instanceof Error ? e.message : String(e),
        })
      }
      return true
    }

    case "memoryRunDiagnostics": {
      try {
        const data = await shibaFetch("/diagnostics", { method: "POST" }, 30_000)
        ctx.postMessage({ type: "memoryDiagnosticsResult", ...(data as object) })
      } catch (e) {
        ctx.postMessage({
          type: "memoryDiagnosticsResult",
          connectivity: false,
          writeTest: false,
          recallTest: false,
          latencyMs: 0,
          errors: [e instanceof Error ? e.message : String(e)],
        })
      }
      return true
    }

    case "memoryLoadRecallTraces": {
      try {
        const data = await shibaFetch("/traces")
        ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: (data as { traces: unknown[] }).traces ?? [] })
      } catch {
        ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] })
      }
      return true
    }

    case "memoryClearRecallTraces": {
      try {
        await shibaFetch("/traces", { method: "DELETE" })
      } catch {
        // best-effort
      }
      ctx.postMessage({ type: "memoryRecallTracesLoaded", traces: [] })
      return true
    }

    case "memoryClearWriteHistory": {
      try {
        await shibaFetch("/history", { method: "DELETE" })
      } catch {
        // best-effort
      }
      ctx.postMessage({ type: "memoryWriteHistoryLoaded", history: [] })
      return true
    }

    default:
      return false
  }
}
