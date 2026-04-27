/**
 * zeroclaw-webview.ts (real-backend wiring, agent-wire-tabs-real)
 *
 * Bridges webview messages from ZeroClawTab.tsx → ZeroClaw approval service
 * via the Hub.
 *
 * Backend endpoints (ZeroClaw service shipped in commit e9c9bf5):
 *     GET  https://hermes.daveai.tech/zeroclaw/queue
 *     POST https://hermes.daveai.tech/zeroclaw/approve  { task_id, approver }
 *     POST https://hermes.daveai.tech/zeroclaw/reject   { task_id, reason? }
 *
 * Auth: Bearer Hermes API key from SecretStorage (Hub gate).
 *
 * Message types handled (NEW prefixed style — `zeroclaw.<action>`):
 *   zeroclaw.queue   → GET  /zeroclaw/queue
 *   zeroclaw.approve → POST /zeroclaw/approve
 *   zeroclaw.reject  → POST /zeroclaw/reject
 *
 * Host responds with `{ type: "zeroclaw.update", payload: { kind, ... } }`.
 *
 * NOTE: the existing in-process ZeroClawService still drives local task
 * lifecycle (submit/cancel/retry). This handler ONLY federates the *remote
 * approval queue* — i.e. tasks running on the Hub-side ZeroClaw worker that
 * need a human at the IDE to approve/reject before execution. The two
 * sources are surfaced together in the tab.
 */

import * as vscode from "vscode"

const HUB_BASE = process.env.KILO_HUB_BASE ?? "https://hermes.daveai.tech"
const HERMES_KEY_ID = "kilo-code.new.hermes.apiKey"
const FETCH_TIMEOUT_MS = 15_000

export interface ZeroClawRealWebviewContext {
  extensionContext: vscode.ExtensionContext
  postMessage: (msg: unknown) => void
}

interface ZeroClawQueueItem {
  task_id: string
  description: string
  risk_level: "low" | "medium" | "high"
  project_path: string
  requested_by?: string
  requested_at: number
  diff_preview?: string
  network_policy?: "deny" | "allowlist" | "open"
  write_policy?: "read_only" | "buffered" | "approved"
}

async function readApiKey(ctx: vscode.ExtensionContext): Promise<string | undefined> {
  const stored = await ctx.secrets.get(HERMES_KEY_ID)
  if (stored && stored.length > 0) return stored
  return process.env.HERMES_API_KEY ?? process.env.MINIMAX_API_KEY
}

async function zcFetch<T>(
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
      throw new Error(`ZeroClaw ${path} → HTTP ${res.status}: ${body.slice(0, 200)}`)
    }
    return (await res.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export async function handleZeroClawRealWebviewMessage(
  msg: Record<string, unknown>,
  ctx: ZeroClawRealWebviewContext,
): Promise<boolean> {
  const type = msg.type
  if (typeof type !== "string" || !type.startsWith("zeroclaw.")) return false

  switch (type) {
    case "zeroclaw.queue": {
      try {
        const data = await zcFetch<{ queue: ZeroClawQueueItem[] }>(
          ctx.extensionContext,
          "/zeroclaw/queue",
        )
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "queue", queue: data.queue ?? [], loadedAt: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "queue", queue: [], error: e instanceof Error ? e.message : String(e) },
        })
      }
      return true
    }

    case "zeroclaw.approve": {
      const task_id = (msg.task_id as string | undefined) ?? (msg.taskId as string | undefined)
      if (!task_id) {
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "approve", error: "task_id is required" },
        })
        return true
      }
      const approver = (msg.approver as string | undefined) ?? "kilo-user"
      try {
        const data = await zcFetch<{ ok: boolean; task_id: string; status: string }>(
          ctx.extensionContext,
          "/zeroclaw/approve",
          {
            method: "POST",
            body: JSON.stringify({ task_id, approver }),
          },
        )
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "approve", task_id, approver, response: data, ts: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: {
            kind: "approve",
            task_id,
            approver,
            error: e instanceof Error ? e.message : String(e),
          },
        })
      }
      return true
    }

    case "zeroclaw.reject": {
      const task_id = (msg.task_id as string | undefined) ?? (msg.taskId as string | undefined)
      if (!task_id) {
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "reject", error: "task_id is required" },
        })
        return true
      }
      const reason = (msg.reason as string | undefined) ?? ""
      try {
        const data = await zcFetch<{ ok: boolean; task_id: string; status: string }>(
          ctx.extensionContext,
          "/zeroclaw/reject",
          {
            method: "POST",
            body: JSON.stringify({ task_id, reason }),
          },
        )
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: { kind: "reject", task_id, reason, response: data, ts: Date.now() },
        })
      } catch (e) {
        ctx.postMessage({
          type: "zeroclaw.update",
          payload: {
            kind: "reject",
            task_id,
            reason,
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
export const __test = { HUB_BASE, HERMES_KEY_ID, zcFetch }
