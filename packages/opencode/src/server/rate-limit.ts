// devilcode_change - Bun-native rate limiter middleware (replaces hono-rate-limiter)
import type { Context, Next } from "hono"
import { getBunServer } from "hono/bun"
import { Log } from "../util/log"

const log = Log.create({ service: "rate-limit" })

export type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number
  /** Maximum number of requests per key per window. */
  limit: number
  /** Custom key extractor; defaults to client IP. */
  keyGenerator?: (c: Context) => string
  /** Optional path predicate; return false to bypass for that request. */
  shouldApply?: (c: Context) => boolean
  /** Standardized rate-limit response headers (draft-6). Defaults to true. */
  standardHeaders?: boolean
  /** Optional callback to append headers or observability when a request is rejected. */
  onRejected?: (
    c: Context,
    res: Response,
    info: { key: string; count: number; limit: number; resetAt: number; now: number },
  ) => void | Promise<void>
  /** Optional clock injection for tests. */
  now?: () => number
}

type Bucket = {
  count: number
  resetAt: number
}

function loopback(address: string) {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1" || address === "0:0:0:0:0:0:0:1"
}

function localKey(c: Context, address?: string, port?: number) {
  return [
    address ?? "local",
    port ? String(port) : "-",
    c.req.header("x-kilo-directory") ?? "-",
    c.req.header("origin") ?? "-",
    c.req.header("user-agent")?.slice(0, 128) ?? "-",
  ].join("|")
}

type BunServerLike = {
  requestIP?: (req: Request) => { address: string; family: string; port: number } | null
}

const DEFAULT_KEY = (c: Context) => {
  const server = getBunServer<BunServerLike>(c)
  const info = server?.requestIP?.(c.req.raw)
  if (!info?.address) return localKey(c)
  if (loopback(info.address)) return localKey(c, info.address, info.port)
  return info.address
}

/**
 * Fixed-window rate limiter. Tracks per-key counters in-process.
 *
 * Trade-offs:
 * - Per-process state — multiple workers will track independently. Acceptable for the
 *   single-instance Devil server use case (CLI-spawned). Use a shared store if we add
 *   horizontal scaling.
 * - Fixed window: bursts at window boundaries are possible. Mitigated by short windows.
 */
export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>()
  const keyOf = options.keyGenerator ?? DEFAULT_KEY
  const headers = options.standardHeaders ?? true
  const now = options.now ?? Date.now

  // Periodic cleanup so the map does not grow unbounded under varied keys.
  const sweep = () => {
    const t = now()
    for (const [k, v] of buckets) {
      if (v.resetAt <= t) buckets.delete(k)
    }
  }
  // Bun supports unref(); avoid keeping the process alive solely for sweeps.
  const interval = setInterval(sweep, Math.max(options.windowMs, 30_000))
  if ("unref" in interval && typeof interval.unref === "function") interval.unref()

  return async function rateLimitMiddleware(c: Context, next: Next) {
    if (options.shouldApply && !options.shouldApply(c)) return next()
    const key = keyOf(c)
    const t = now()
    const bucket = (() => {
      const found = buckets.get(key)
      if (found && found.resetAt > t) return found
      const fresh = { count: 0, resetAt: t + options.windowMs }
      buckets.set(key, fresh)
      return fresh
    })()
    bucket.count++

    const remaining = Math.max(0, options.limit - bucket.count)
    if (headers) {
      c.header("RateLimit-Limit", String(options.limit))
      c.header("RateLimit-Remaining", String(remaining))
      c.header("RateLimit-Reset", String(Math.ceil((bucket.resetAt - t) / 1000)))
    }

    if (bucket.count > options.limit) {
      log.warn("rate_limited", { key, path: c.req.path, count: bucket.count })
      if (headers) {
        c.header("Retry-After", String(Math.ceil((bucket.resetAt - t) / 1000)))
      }
      const res = new Response(JSON.stringify({ error: "Too Many Requests" }), {
        status: 429,
        headers: new Headers({
          ...Object.fromEntries(c.res.headers.entries()),
          "Content-Type": "application/json; charset=UTF-8",
        }),
      })
      await options.onRejected?.(c, res, {
        key,
        count: bucket.count,
        limit: options.limit,
        resetAt: bucket.resetAt,
        now: t,
      })
      return res
    }

    return next()
  }
}
