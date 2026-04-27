/**
 * training-webview.ts
 *
 * Bridges webview messages from TrainingTab.tsx → the Hub's
 * /api/training/* endpoints, plus an SSE subscription that forwards
 * progress events back to the UI as `training.progress` messages.
 *
 * Hub default base URL: http://localhost:8095 (override with the VS Code
 * setting `kilo.hub.baseUrl` or env var `KILO_HUB_BASE_URL`).
 *
 * Message types handled:
 *   training.start                  → POST /api/training/start
 *   training.list                   → GET  /api/training/jobs
 *   training.cancel.<job_id>        → POST /api/training/jobs/<job_id>/cancel
 *
 * For every started job we open an SSE subscription against
 * /api/events?topics=training.progress.<job_id> and forward each event
 * back to the webview as { type: "training.progress", payload }.
 *
 * The Hub mock executor sets `payload.mocked = true` on every event;
 * the UI uses that flag to render a "MOCK MODE" badge.
 */

import * as http from "http"
import * as https from "https"
import { URL } from "url"

const DEFAULT_HUB_BASE = process.env.KILO_HUB_BASE_URL ?? "http://localhost:8095"
const FETCH_TIMEOUT_MS = 10_000

export interface TrainingWebviewContext {
  postMessage: (msg: unknown) => void
  hubBaseUrl?: string
  // Injectable for tests — pluggable HTTP transport.
  fetchImpl?: typeof fetch
  // Injectable for tests — pluggable SSE subscriber.
  subscribeSseImpl?: (
    url: string,
    onEvent: (data: Record<string, unknown>) => void,
    onError: (err: Error) => void,
  ) => () => void
}

interface StartJobBody {
  model: string
  dataset_id: string
  epochs: number
  learning_rate: number
}

interface StartJobResponse {
  ok: boolean
  job_id: string
  mocked: boolean
  topic: string
  job: Record<string, unknown>
}

// Track active SSE subscriptions so we can clean them up on cancel/dispose.
const activeSubscriptions = new Map<string, () => void>()

function hubBase(ctx: TrainingWebviewContext): string {
  return (ctx.hubBaseUrl ?? DEFAULT_HUB_BASE).replace(/\/$/, "")
}

function getFetch(ctx: TrainingWebviewContext): typeof fetch {
  return ctx.fetchImpl ?? fetch
}

async function hubFetchJson(
  ctx: TrainingWebviewContext,
  path: string,
  init: RequestInit = {},
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<unknown> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  const fetchFn = getFetch(ctx)
  try {
    const res = await fetchFn(`${hubBase(ctx)}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    })
    if (!res.ok) {
      const body = await res.text().catch(() => "")
      throw new Error(`Hub ${path} -> HTTP ${res.status}: ${body}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Subscribe to a Hub SSE topic via stdlib http(s). Returns a disposer that
 * tears down the connection. The Hub emits each event as
 *   event: <topic>\n
 *   data: {"topic":..., "ts":..., "payload":{...}}\n\n
 * — we only care about the JSON `data:` line.
 */
export function subscribeSse(
  fullUrl: string,
  onEvent: (data: Record<string, unknown>) => void,
  onError: (err: Error) => void,
): () => void {
  const u = new URL(fullUrl)
  const lib = u.protocol === "https:" ? https : http
  let buffer = ""
  let aborted = false

  const req = lib.request(
    {
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      method: "GET",
      path: `${u.pathname}${u.search}`,
      headers: {
        Accept: "text/event-stream",
        "Cache-Control": "no-cache",
      },
    },
    (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        onError(new Error(`SSE -> HTTP ${res.statusCode}`))
        res.resume()
        return
      }
      res.setEncoding("utf8")
      res.on("data", (chunk: string) => {
        if (aborted) return
        buffer += chunk
        // Split on blank lines (event boundary).
        let idx: number
        while ((idx = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, idx)
          buffer = buffer.slice(idx + 2)
          for (const line of frame.split("\n")) {
            const trimmed = line.trim()
            if (!trimmed.startsWith("data:")) continue
            const json = trimmed.slice(5).trim()
            if (!json) continue
            try {
              onEvent(JSON.parse(json) as Record<string, unknown>)
            } catch (parseErr) {
              onError(parseErr instanceof Error ? parseErr : new Error(String(parseErr)))
            }
          }
        }
      })
      res.on("end", () => {
        if (!aborted) onError(new Error("SSE stream ended"))
      })
      res.on("error", (err) => onError(err))
    },
  )

  req.on("error", (err) => onError(err))
  req.end()

  return () => {
    aborted = true
    try {
      req.destroy()
    } catch {
      // ignore
    }
  }
}

function startSseSubscription(
  ctx: TrainingWebviewContext,
  jobId: string,
  topic: string,
): void {
  // Tear down any prior subscription for the same job.
  const prior = activeSubscriptions.get(jobId)
  if (prior) {
    try {
      prior()
    } catch {
      // ignore
    }
  }

  const url = `${hubBase(ctx)}/api/events?topics=${encodeURIComponent(topic)}`
  const subscribe = ctx.subscribeSseImpl ?? subscribeSse

  const dispose = subscribe(
    url,
    (event) => {
      // The Hub envelope is { topic, ts, payload }. Forward the payload
      // so the webview gets a flat event with mocked / progress / loss.
      const payload = (event.payload ?? event) as Record<string, unknown>
      ctx.postMessage({ type: "training.progress", jobId, payload })

      const status = (payload.status as string | undefined) ?? ""
      if (status === "completed" || status === "failed" || status === "cancelled") {
        const sub = activeSubscriptions.get(jobId)
        if (sub) {
          activeSubscriptions.delete(jobId)
          try {
            sub()
          } catch {
            // ignore
          }
        }
      }
    },
    (err) => {
      ctx.postMessage({
        type: "training.progress",
        jobId,
        payload: { error: err.message, mocked: true, status: "stream_error" },
      })
    },
  )

  activeSubscriptions.set(jobId, dispose)
}

// eslint-disable-next-line complexity
export async function handleTrainingWebviewMessage(
  msg: Record<string, unknown>,
  ctx: TrainingWebviewContext,
): Promise<boolean> {
  const type = msg.type as string | undefined
  if (!type) return false

  if (type === "training.start") {
    const body: StartJobBody = {
      model: String(msg.model ?? ""),
      dataset_id: String(msg.dataset_id ?? msg.datasetId ?? ""),
      epochs: Number(msg.epochs ?? 3),
      learning_rate: Number(msg.learning_rate ?? msg.learningRate ?? 3e-4),
    }
    if (!body.model || !body.dataset_id) {
      ctx.postMessage({
        type: "training.error",
        error: "training.start requires model and dataset_id",
      })
      return true
    }
    try {
      const res = (await hubFetchJson(ctx, "/api/training/start", {
        method: "POST",
        body: JSON.stringify(body),
      })) as StartJobResponse
      ctx.postMessage({
        type: "training.started",
        jobId: res.job_id,
        mocked: res.mocked,
        job: res.job,
      })
      startSseSubscription(ctx, res.job_id, res.topic)
    } catch (err) {
      ctx.postMessage({
        type: "training.error",
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  if (type === "training.list") {
    try {
      const res = (await hubFetchJson(ctx, "/api/training/jobs")) as {
        ok: boolean
        jobs: Record<string, unknown>[]
      }
      ctx.postMessage({ type: "training.list", jobs: res.jobs ?? [] })
    } catch (err) {
      ctx.postMessage({
        type: "training.error",
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  if (type.startsWith("training.cancel.")) {
    const jobId = type.slice("training.cancel.".length)
    if (!jobId) return true
    try {
      await hubFetchJson(ctx, `/api/training/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
      })
      ctx.postMessage({ type: "training.cancelled", jobId })
    } catch (err) {
      ctx.postMessage({
        type: "training.error",
        jobId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
    return true
  }

  return false
}

/** Tear down all active SSE subscriptions; call on extension deactivation. */
export function disposeAllTrainingSubscriptions(): void {
  for (const [, dispose] of activeSubscriptions) {
    try {
      dispose()
    } catch {
      // ignore
    }
  }
  activeSubscriptions.clear()
}
