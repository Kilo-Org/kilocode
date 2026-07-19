// Shared file-link candidate validator used by message-part.tsx.
//
// This is intentionally a module-level singleton, not per-component state:
// - Virtualized transcripts unmount/remount TextPartDisplay instances as rows
//   scroll in and out of the overscan buffer. A per-component cache would be
//   discarded and rebuilt on every remount, repeating filesystem checks for
//   unchanged completed history. A module-level cache survives remounts.
// - Multiple mounted rows can reference the same path concurrently (e.g. a
//   file mentioned more than once in a transcript). Without shared in-flight
//   tracking each row would issue its own redundant validateFiles request.
//
// Requests for the same session are coalesced into one batch per microtask
// tick, so many candidates validated back-to-back in the same animation
// frame (as MutationObserver-driven passes do) become a single round trip.
import type { ValidateFilesFn } from "./context/data"

const MAX_CACHE = 2000

export type CheckOptions = {
  // How many times to re-attempt a rejected/timed-out validation before
  // resolving `undefined` (never `false`).
  maxAttempts: number
  // Backoff between retry attempts, in ms.
  retryDelayMs: number
  // How long a confirmed "does not exist" stays cached, in ms. A path may be
  // mentioned before its file is created during streaming, so negatives are
  // re-checked after this window instead of staying plain for the whole
  // session. Confirmed positives never expire.
  negativeTtlMs: number
}

const DEFAULTS: CheckOptions = { maxAttempts: 3, retryDelayMs: 2000, negativeTtlMs: 30_000 }

type Entry = { exists: boolean; expires: number }

// key: `${sessionID}::${path}`
const cache = new Map<string, Entry>()
const inflight = new Map<string, Promise<boolean | undefined>>()

type Batch = {
  paths: Set<string>
  resolvers: Map<string, Array<(exists: boolean | undefined) => void>>
  config: CheckOptions
}

const batches = new Map<string, Batch>()

function key(sessionID: string, path: string): string {
  return `${sessionID}::${path}`
}

function remember(k: string, exists: boolean, negativeTtlMs: number): void {
  // Map iteration order is insertion order, and reads refresh recency (see
  // checkFile), so evicting the first key drops the least-recently-used entry.
  cache.delete(k)
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(k, { exists, expires: exists ? Infinity : Date.now() + negativeTtlMs })
}

function settle(batch: Batch, path: string, exists: boolean | undefined): void {
  const resolvers = batch.resolvers.get(path) ?? []
  for (const resolve of resolvers) resolve(exists)
}

function runBatch(sessionID: string, batch: Batch, validateFiles: ValidateFilesFn, attempt: number): void {
  const paths = Array.from(batch.paths)
  validateFiles(sessionID, paths).then(
    (existing) => {
      const set = new Set(existing)
      for (const p of paths) {
        const exists = set.has(p)
        remember(key(sessionID, p), exists, batch.config.negativeTtlMs)
        inflight.delete(key(sessionID, p))
        settle(batch, p, exists)
      }
    },
    () => {
      // A timeout/failure is not authoritative — it must never be cached as
      // "file doesn't exist". Retry a few times with a short backoff before
      // giving up; even then, giving up resolves as `undefined` (unknown),
      // not `false`, so the caller leaves the candidate untouched instead of
      // demoting a real file to plain text.
      if (attempt + 1 < batch.config.maxAttempts) {
        setTimeout(() => runBatch(sessionID, batch, validateFiles, attempt + 1), batch.config.retryDelayMs)
        return
      }
      for (const p of paths) {
        inflight.delete(key(sessionID, p))
        settle(batch, p, undefined)
      }
    },
  )
}

/**
 * Resolve whether `path` exists as a file, scoped to `sessionID`.
 *
 * Returns `true`/`false` once confirmed, or `undefined` if validation could
 * not be confirmed (e.g. every retry timed out) — callers should treat
 * `undefined` as "leave as-is", not as a negative result.
 *
 * `opts` tunes retry/TTL behavior. Note the config is per-batch: the first
 * caller to open a per-tick batch for a session fixes the config for that
 * batch, so callers batched into the same microtask tick share one config.
 * Production callers omit `opts` and rely on DEFAULTS; `opts` exists for tests.
 */
export function checkFile(
  sessionID: string,
  path: string,
  validateFiles: ValidateFilesFn,
  opts?: Partial<CheckOptions>,
): Promise<boolean | undefined> {
  const k = key(sessionID, path)
  const cached = cache.get(k)
  if (cached && (cached.exists || Date.now() < cached.expires)) {
    // Refresh recency so the LRU eviction in remember() keeps hot entries.
    cache.delete(k)
    cache.set(k, cached)
    return Promise.resolve(cached.exists)
  }
  if (cached) cache.delete(k) // expired negative → re-validate
  const existing = inflight.get(k)
  if (existing) return existing

  const batch: Batch = batches.get(sessionID) ?? {
    paths: new Set(),
    resolvers: new Map(),
    config: { ...DEFAULTS, ...opts },
  }
  const isNewBatch = !batches.has(sessionID)
  batches.set(sessionID, batch)
  batch.paths.add(path)

  const promise = new Promise<boolean | undefined>((resolve) => {
    const resolvers = batch.resolvers.get(path) ?? []
    resolvers.push(resolve)
    batch.resolvers.set(path, resolvers)
  })
  inflight.set(k, promise)

  if (isNewBatch) {
    queueMicrotask(() => {
      batches.delete(sessionID)
      runBatch(sessionID, batch, validateFiles, 0)
    })
  }

  return promise
}
