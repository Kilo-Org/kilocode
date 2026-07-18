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
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 2000

// key: `${sessionID}::${path}`
const cache = new Map<string, boolean>()
const inflight = new Map<string, Promise<boolean | undefined>>()

type Batch = {
  paths: Set<string>
  resolvers: Map<string, Array<(exists: boolean | undefined) => void>>
}

const batches = new Map<string, Batch>()

function key(sessionID: string, path: string): string {
  return `${sessionID}::${path}`
}

function remember(k: string, exists: boolean): void {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(k, exists)
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
        remember(key(sessionID, p), exists)
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
      if (attempt + 1 < MAX_ATTEMPTS) {
        setTimeout(() => runBatch(sessionID, batch, validateFiles, attempt + 1), RETRY_DELAY_MS)
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
 */
export function checkFile(
  sessionID: string,
  path: string,
  validateFiles: ValidateFilesFn,
): Promise<boolean | undefined> {
  const k = key(sessionID, path)
  if (cache.has(k)) return Promise.resolve(cache.get(k)!)
  const existing = inflight.get(k)
  if (existing) return existing

  const batch = batches.get(sessionID) ?? { paths: new Set(), resolvers: new Map() }
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
