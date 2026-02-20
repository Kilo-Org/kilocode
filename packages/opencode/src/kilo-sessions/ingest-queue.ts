import { ulid } from "ulid"
import type * as SDK from "@kilocode/sdk/v2"
import type { Session } from "@/session"

export namespace IngestQueue {
  export type Client = {
    url: string
    fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  }

  export type CloseReason = Session.CloseReason

  export type Data =
    | {
        type: "kilo_meta"
        data: {
          platform: string
          orgId?: string
          gitUrl?: string
          gitBranch?: string
        }
      }
    | {
        type: "session"
        data: SDK.Session
      }
    | {
        type: "message"
        data: SDK.Message
      }
    | {
        type: "part"
        data: SDK.Part
      }
    | {
        type: "session_diff"
        data: SDK.FileDiff[]
      }
    | {
        type: "model"
        data: SDK.Model[]
      }
    | {
        type: "session_open"
        data: Record<string, never>
      }
    | {
        type: "session_close"
        data: { reason: CloseReason }
      }

  type Share = {
    ingestPath: string
  }

  type Timer = ReturnType<typeof setTimeout>

  export type Options = {
    getShare: (sessionId: string) => Promise<Share | undefined>
    getClient: () => Promise<Client | undefined>
    onAuthError?: () => void
    log: {
      error: (message: string, data: Record<string, unknown>) => void
    }
    now?: () => number
    setTimeout?: (fn: () => void, ms: number) => Timer
    clearTimeout?: (timer: Timer) => void
  }

  export function create(options: Options) {
    // Per-session debounce/flush queue.
    //
    // The share ingest endpoint is updated very frequently (streaming message parts, diffs, etc.).
    // To avoid spamming the server, we coalesce updates and flush at most once per ~1s per session.
    //
    // `due` is the earliest time we should flush; it is also used to respect backoff when retries are
    // active. A later `due` always wins over an earlier one.
    const queue = new Map<string, { timeout: Timer; due: number; data: Map<string, Data> }>()

    // Per-session retry state.
    //
    // We keep retry logic intentionally simple and local:
    // - Only retry a small set of transient errors (network, 429, 5xx, etc.)
    // - Use exponential backoff with a small max budget to prevent infinite loops/log spam
    // - Store `until` so sync() can avoid scheduling a flush before backoff expires
    const retry = new Map<string, { count: number; until: number }>()

    const now = options.now ?? (() => Date.now())
    const set = options.setTimeout ?? ((fn, ms) => setTimeout(fn, ms))
    const clear = options.clearTimeout ?? ((timer) => clearTimeout(timer))

    function retryable(status: number) {
      // Retry only statuses that are likely transient.
      if (status === 408) return true
      if (status === 409) return true
      if (status === 425) return true
      if (status === 429) return true
      if (status >= 500) return true
      return false
    }

    function backoff(count: number) {
      // Exponential backoff capped to keep the system responsive.
      const clamped = Math.min(count, 6)
      return Math.min(60_000, 1_000 * 2 ** (clamped - 1))
    }

    function id(value: unknown) {
      if (!value) return undefined
      if (typeof value !== "object") return undefined
      if (!("id" in value)) return undefined
      const result = (value as { id?: unknown }).id
      if (typeof result === "string" && result.length > 0) return result
      return undefined
    }

    function key(item: Data) {
      // Stable keys are important so updates for the same entity collapse to a single queued item.
      // If we can't derive a stable key, we fall back to a random key (ulid) so the item is still sent.
      if (item.type === "kilo_meta") return "kilo_meta"
      if (item.type === "session") return "session"
      if (item.type === "session_diff") return "session_diff"
      if (item.type === "session_open") return "session_open"
      if (item.type === "session_close") return "session_close"

      if (item.type === "message") {
        const value = id(item.data)
        return value ? `message:${value}` : ulid()
      }

      if (item.type === "part") {
        const value = id(item.data)
        return value ? `part:${value}` : ulid()
      }

      const models = item.data
        .map((m) => `${m.providerID}:${m.id}`)
        .sort()
        .join(",")
      return models.length > 0 ? `model:${models}` : ulid()
    }

    function schedule(sessionId: string, due: number, data: Map<string, Data>) {
      const existing = queue.get(sessionId)
      if (existing) {
        // Don't reschedule if an earlier flush is already planned.
        // We only move the flush later (e.g., to respect backoff).
        if (existing.due >= due) return
        clear(existing.timeout)
      }

      const wait = Math.max(0, due - now())
      const timeout = set(() => {
        void flush(sessionId)
      }, wait)
      queue.set(sessionId, { timeout, due, data })
    }

    function enqueue(sessionId: string, items: Data[], mode: "overwrite" | "fill", due: number) {
      const existing = queue.get(sessionId)
      if (existing) {
        for (const item of items) {
          const k = key(item)
          // overwrite: normal event updates (newer data should win)
          // fill: retry requeue (never clobber newer updates that arrived while a flush was in-flight)
          if (mode === "fill" && existing.data.has(k)) continue
          existing.data.set(k, item)
        }
        schedule(sessionId, due, existing.data)
        return
      }

      const data = new Map<string, Data>()
      for (const item of items) {
        data.set(key(item), item)
      }

      schedule(sessionId, due, data)
    }

    async function flush(sessionId: string) {
      // Flush is scheduled by sync() and sends the currently queued payload.
      //
      // Note: we delete the queue entry before the network call so that new incoming events can start
      // a fresh debounce window immediately.
      const queued = queue.get(sessionId)
      if (!queued) return

      clear(queued.timeout)
      queue.delete(sessionId)

      const items = Array.from(queued.data.values())

      try {
        const share = await options.getShare(sessionId).catch(() => undefined)
        if (!share) return

        const client = await options.getClient()
        if (!client) return

        const response = await client
          .fetch(`${client.url}${share.ingestPath}?v=1`, {
            method: "POST",
            body: JSON.stringify({
              data: items,
            }),
          })
          .catch(() => undefined)

        if (!response) {
          // Network failures are assumed transient; retry with backoff and a small budget.
          const count = (retry.get(sessionId)?.count ?? 0) + 1
          if (count > 6) {
            options.log.error("share sync failed", { sessionId, error: "retry budget exceeded" })
            retry.delete(sessionId)
            return
          }

          const delay = backoff(count)
          retry.set(sessionId, { count, until: now() + delay })
          options.log.error("share sync failed", { sessionId, error: "network", retryInMs: delay })
          enqueue(sessionId, items, "fill", now() + delay)
          return
        }

        if (response.ok) {
          retry.delete(sessionId)
          return
        }

        if (response.status === 401 || response.status === 403) {
          // Non-retryable until credentials are fixed.
          options.onAuthError?.()
          options.log.error("share sync failed", {
            sessionId,
            status: response.status,
            statusText: response.statusText,
          })
          retry.delete(sessionId)
          return
        }

        if (!retryable(response.status)) {
          // Permanent-ish failures (eg. 404 due to bad ingestPath) should not loop forever.
          options.log.error("share sync failed", {
            sessionId,
            status: response.status,
            statusText: response.statusText,
          })
          retry.delete(sessionId)
          return
        }

        const current = retry.get(sessionId)
        const count = (current?.count ?? 0) + 1
        if (count > 6) {
          options.log.error("share sync failed", { sessionId, error: "retry budget exceeded" })
          retry.delete(sessionId)
          return
        }

        const delay = backoff(count)
        retry.set(sessionId, { count, until: now() + delay })
        options.log.error("share sync failed", {
          sessionId,
          status: response.status,
          statusText: response.statusText,
          retryInMs: delay,
        })
        enqueue(sessionId, items, "fill", now() + delay)
      } catch (error) {
        options.log.error("share sync failed", { sessionId, error })
      }
    }

    async function sync(sessionId: string, data: Data[]) {
      // sync() is called by event handlers and is intentionally cheap:
      // - If sharing isn't configured (no token / disabled), we skip queueing.
      // - Otherwise, merge into the pending queue entry.
      //   The next flush is scheduled ~1s after the first queued event (throttled), but never earlier
      //   than the current backoff window (if retries are active).
      const client = await options.getClient()
      if (!client) return

      const until = retry.get(sessionId)?.until ?? 0
      const base = queue.get(sessionId)?.due ?? now() + 1000
      const due = Math.max(base, until)
      enqueue(sessionId, data, "overwrite", due)
    }

    return {
      sync,
      flush,
    } as const
  }
}
