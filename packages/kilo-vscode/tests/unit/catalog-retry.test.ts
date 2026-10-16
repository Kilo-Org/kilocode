import { describe, expect, it } from "bun:test"
import { createCatalogRetry } from "../../src/kilo-provider/catalog-retry"

function setup() {
  const pending: Array<{ run: () => void; ms: number; cancelled: boolean }> = []
  let refreshes = 0
  const retry = createCatalogRetry({
    refresh: () => refreshes++,
    delays: [10, 20, 40],
    schedule: (run, ms) => {
      const entry = { run, ms, cancelled: false }
      pending.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
  })
  const fire = () => {
    const entry = pending.at(-1)
    if (!entry || entry.cancelled) throw new Error("no retry scheduled")
    entry.run()
  }
  return { retry, pending, fire, refreshes: () => refreshes }
}

describe("createCatalogRetry", () => {
  it("does nothing while the catalog is available", () => {
    const state = setup()
    state.retry.update(false)
    expect(state.pending).toEqual([])
  })

  it("backs off while the catalog stays unavailable and caps the delay", () => {
    const state = setup()
    for (const _ of [1, 2, 3, 4]) {
      state.retry.update(true)
      state.fire()
    }
    expect(state.pending.map((entry) => entry.ms)).toEqual([10, 20, 40, 40])
    expect(state.refreshes()).toBe(4)
  })

  it("arms only one retry at a time", () => {
    const state = setup()
    state.retry.update(true)
    state.retry.update(true)
    expect(state.pending).toHaveLength(1)
  })

  it("cancels and resets once the catalog recovers", () => {
    const state = setup()
    state.retry.update(true)
    state.fire()
    state.retry.update(true)
    state.retry.update(false)
    expect(state.pending.at(-1)?.cancelled).toBe(true)
    state.retry.update(true)
    expect(state.pending.at(-1)?.ms).toBe(10)
  })

  it("cancels a pending retry on dispose", () => {
    const state = setup()
    state.retry.update(true)
    state.retry.dispose()
    expect(state.pending.at(-1)?.cancelled).toBe(true)
    expect(state.refreshes()).toBe(0)
  })

  it("ignores updates from fetches that settle after dispose", () => {
    const state = setup()
    state.retry.dispose()
    state.retry.update(true)
    expect(state.pending).toEqual([])
  })
})
