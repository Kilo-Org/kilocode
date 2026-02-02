type Entry<T> = {
  at: number
  value: T | undefined
  inflight: Promise<T | undefined> | undefined
}

const store = new Map<string, Entry<unknown>>()

export function withInFlightCache<T>(
  key: string,
  ttlMs: number,
  cb: () => Promise<T | undefined>,
): Promise<T | undefined> {
  const now = Date.now()
  const existing = store.get(key) as Entry<T> | undefined

  if (existing) {
    // If a refresh is in-flight, always await it.
    // This avoids returning a stale cached value while a newer one is being computed.
    if (existing.inflight) return existing.inflight

    // `undefined` means "no value" (and is never cached).
    if (existing.value !== undefined && now - existing.at < ttlMs) return Promise.resolve(existing.value)
  }

  const next: Entry<T> = existing
    ? {
        // Keep the original timestamp until the refresh succeeds.
        // Otherwise, a failed refresh could make an old value look "fresh" and suppress retries.
        at: existing.at,
        value: existing.value,
        inflight: undefined,
      }
    : {
        at: now,
        value: undefined,
        inflight: undefined,
      }

  // Guard against synchronous throws in `cb()` by forcing it into the promise chain.
  // This ensures errors flow through the `.catch()` below and the cache entry is cleaned up.
  const task = Promise.resolve()
    .then(() => cb())
    .then((value) => {
      if (value === undefined) {
        // `undefined` is treated as a non-cacheable sentinel.
        // Drop the entry entirely so future calls retry instead of serving stale data.
        store.delete(key)
        return undefined
      }

      next.value = value
      next.at = Date.now()
      return value
    })
    .catch((error) => {
      store.delete(key)
      throw error
    })

  const inflight = task.finally(() => {
    next.inflight = undefined
  })

  next.inflight = inflight
  store.set(key, next as Entry<unknown>)
  return inflight
}

export function clearInFlightCache(key: string) {
  store.delete(key)
}
