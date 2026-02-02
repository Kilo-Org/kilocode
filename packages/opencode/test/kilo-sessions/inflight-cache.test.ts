import { afterEach, describe, expect, test } from "bun:test"
import { clearInFlightCache, withInFlightCache } from "../../src/kilo-sessions/inflight-cache"

function deferred<T>() {
  const state = {
    resolve: undefined as ((value: T) => void) | undefined,
    reject: undefined as ((reason?: unknown) => void) | undefined,
  }

  const promise = new Promise<T>((resolve, reject) => {
    state.resolve = resolve
    state.reject = reject
  })

  return { promise, resolve: state.resolve!, reject: state.reject! }
}

describe("withInFlightCache", () => {
  const realNow = Date.now
  const clock = { now: 0 }

  afterEach(() => {
    Date.now = realNow
  })

  test("dedupes concurrent calls (inflight)", async () => {
    Date.now = () => clock.now
    const key = "inflight-dedupe"
    clearInFlightCache(key)

    const job = deferred<number>()
    const calls = { count: 0 }
    const cb = () => {
      calls.count += 1
      return job.promise
    }

    const a = withInFlightCache(key, 10_000, cb)
    const b = withInFlightCache(key, 10_000, cb)

    expect(a).toBe(b)
    // cb() is invoked via a microtask in withInFlightCache().
    // Allow it to run before asserting call count.
    await Promise.resolve()
    expect(calls.count).toBe(1)

    job.resolve(123)
    expect(await a).toBe(123)
    expect(await b).toBe(123)

    clearInFlightCache(key)
  })

  test("returns cached value within ttl without calling cb again", async () => {
    Date.now = () => clock.now
    const key = "cache-hit"
    clearInFlightCache(key)

    const calls = { count: 0 }
    const cb = async () => {
      calls.count += 1
      return "ok"
    }

    expect(await withInFlightCache(key, 10_000, cb)).toBe("ok")
    expect(calls.count).toBe(1)

    clock.now += 5
    expect(await withInFlightCache(key, 10_000, cb)).toBe("ok")
    expect(calls.count).toBe(1)

    clearInFlightCache(key)
  })

  test("does not cache undefined (treats as no value)", async () => {
    Date.now = () => clock.now
    const key = "cache-undefined"
    clearInFlightCache(key)

    const calls = { count: 0 }
    const cb = async () => {
      calls.count += 1
      return undefined
    }

    expect(await withInFlightCache(key, 10_000, cb)).toBeUndefined()
    expect(calls.count).toBe(1)

    clock.now += 5
    expect(await withInFlightCache(key, 10_000, cb)).toBeUndefined()
    expect(calls.count).toBe(2)

    clearInFlightCache(key)
  })

  test("expires cached entries after ttl and recomputes", async () => {
    Date.now = () => clock.now
    const key = "ttl-expire"
    clearInFlightCache(key)

    const calls = { count: 0 }
    const cb = async () => {
      calls.count += 1
      return calls.count
    }

    expect(await withInFlightCache(key, 10, cb)).toBe(1)
    clock.now += 11
    expect(await withInFlightCache(key, 10, cb)).toBe(2)

    clearInFlightCache(key)
  })

  test("does not return stale cached value while refresh is in-flight", async () => {
    Date.now = () => clock.now
    const key = "refresh-inflight"
    clearInFlightCache(key)

    // Seed a cached value.
    expect(await withInFlightCache(key, 10, async () => 1)).toBe(1)

    // Expire it.
    clock.now += 11

    // Start a refresh that we can hold.
    const job = deferred<number>()
    const refresh = withInFlightCache(key, 10, () => job.promise)

    // Subsequent callers must await refresh, not get the old cached value.
    const follower = withInFlightCache(key, 10, async () => 999)
    expect(follower).toBe(refresh)

    job.resolve(2)
    expect(await refresh).toBe(2)
    expect(await follower).toBe(2)

    clearInFlightCache(key)
  })

  test("clearInFlightCache forces recompute", async () => {
    Date.now = () => clock.now
    const key = "clear"
    clearInFlightCache(key)

    const calls = { count: 0 }
    const cb = async () => {
      calls.count += 1
      return calls.count
    }

    expect(await withInFlightCache(key, 10_000, cb)).toBe(1)
    clearInFlightCache(key)
    expect(await withInFlightCache(key, 10_000, cb)).toBe(2)

    clearInFlightCache(key)
  })
})
