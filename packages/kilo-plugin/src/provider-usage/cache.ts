export * as UsageCache from "./cache"

import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { createHash } from "node:crypto"

// The per-source cache of the direct usage sources, as v1 kept it (packages/core/src/kilocode/provider-usage.ts on
// main): 60 seconds after a good answer, 10 seconds after a failure, scoped to the credential so a new key never
// shows the quota of the previous one, and the last good windows kept as stale when a fetch or a credential read fails.
const successTtl = 60_000
const errorTtl = 10_000

interface Cell {
  identity: string
  value: ProviderUsage.UsageSnapshot
  expires: number
  updated: number
}

export function make(now: () => number = Date.now) {
  const cells = new Map<string, Cell>()
  const store = (id: string, identity: string, value: ProviderUsage.UsageSnapshot, ttl: number) => {
    cells.set(id, { identity, value, expires: now() + ttl, updated: now() })
    return value
  }
  return {
    async source(id: string, secret: string, force: boolean, load: () => Promise<ProviderUsage.UsageSnapshot>) {
      const identity = createHash("sha256").update(secret).digest("hex")
      const cell = cells.get(id)
      const previous = cell?.identity === identity ? cell : undefined
      if (!force && previous && previous.expires > now()) return previous.value
      const value = stale(await load(), previous?.value)
      return store(id, identity, value, value.fetchState === "ready" ? successTtl : errorTtl)
    },
    /** The last snapshot of a source whose credential could not be read, marked stale. */
    preserve(id: string): ProviderUsage.UsageSnapshot[] {
      const cell = cells.get(id)
      if (!cell) return []
      const loaded = cell.value.fetchState === "ready" || cell.value.fetchState === "stale"
      const value = loaded
        ? {
            ...cell.value,
            fetchState: "stale" as const,
            error: {
              code: "source_refresh_unavailable",
              message: "The latest usage could not be loaded.",
              retryable: true,
            },
          }
        : cell.value
      return [store(id, cell.identity, value, errorTtl)]
    },
    /** Drops the sources that are gone and returns the time of the newest data, as v1 `generatedAt`. */
    settle(items: readonly ProviderUsage.UsageSnapshot[]) {
      const ids = new Set(items.map((item) => item.id))
      for (const id of cells.keys()) if (!ids.has(id)) cells.delete(id)
      // Uncached items (Kilo coding plans) were fetched now.
      const stamps = items.map((item) => cells.get(item.id)?.updated ?? now())
      return new Date(stamps.length ? Math.max(...stamps) : now()).toISOString()
    },
  }
}

function stale(next: ProviderUsage.UsageSnapshot, previous: ProviderUsage.UsageSnapshot | undefined) {
  if (next.fetchState === "ready" || next.error?.retryable === false) return next
  if (!previous || (previous.fetchState !== "ready" && previous.fetchState !== "stale")) return next
  return { ...previous, fetchState: "stale" as const, planState: next.planState, error: next.error }
}
