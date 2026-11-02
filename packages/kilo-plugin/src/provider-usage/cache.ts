export * as UsageCache from "./cache"

import type { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import type { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { createHash } from "node:crypto"
import { managedPrefix } from "./cloud"

// The per-source cache of the direct usage sources, as v1 kept it (packages/core/src/kilocode/provider-usage.ts on
// main): 60 seconds after a good answer, 10 seconds after a failure, scoped to the credential so a new key never
// shows the quota of the previous one, and the last good windows kept as stale when a fetch or a credential read fails.
const successTtl = 60_000
const errorTtl = 10_000

/** A read whose failure is a value, so one failed part never hides the rest. */
export type Result<T> = { ok: true; value: T } | { ok: false }

/** The two Kilo managed plan reads of one account. */
export interface CloudState {
  plans: Result<readonly KiloGatewayRpc.CodingPlanSubscription[]>
  byok: Result<readonly KiloGatewayRpc.ByokEntry[]>
}

/** The Kilo managed account and its two plan reads, cached together so a failed refresh keeps the last good one. */
export interface Cloud extends CloudState {
  identity: string
}

interface Cell {
  identity: string
  value: ProviderUsage.UsageSnapshot
  expires: number
  updated: number
}

interface CloudCell {
  value?: Cloud
  expires: number
  inflight?: { identity: string; task: Promise<Cloud> }
}

export function make(now: () => number = Date.now) {
  const cells = new Map<string, Cell>()
  const inflight = new Map<string, { identity: string; task: Promise<ProviderUsage.UsageSnapshot> }>()
  let cloud: CloudCell = { expires: 0 }
  const store = (id: string, identity: string, value: ProviderUsage.UsageSnapshot, ttl: number) => {
    cells.set(id, { identity, value, expires: now() + ttl, updated: now() })
    return value
  }
  const prune = (prefix: string, keep: readonly string[]) => {
    const ids = new Set(keep)
    for (const id of cells.keys()) if (id.startsWith(prefix) && !ids.has(id)) cells.delete(id)
    // A load still running for a pruned id must not cache its answer when it finishes.
    for (const id of inflight.keys()) if (id.startsWith(prefix) && !ids.has(id)) inflight.delete(id)
  }
  const preserveCell = (id: string, cell: Cell) => {
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
    return store(id, cell.identity, value, errorTtl)
  }
  return {
    /** One load per source and credential at a time: overlapping calls share it, as in v1. */
    source(id: string, secret: string, force: boolean, load: () => Promise<ProviderUsage.UsageSnapshot>) {
      const identity = createHash("sha256").update(secret).digest("hex")
      const cell = cells.get(id)
      const previous = cell?.identity === identity ? cell : undefined
      if (!force && previous && previous.expires > now()) return Promise.resolve(previous.value)
      const running = inflight.get(id)
      if (running?.identity === identity) return running.task
      const task = load()
        .then((next) => {
          const value = stale(next, previous?.value)
          // A newer credential replaced this load while it ran: answer without caching.
          if (inflight.get(id)?.task !== task) return value
          return store(id, identity, value, value.fetchState === "ready" ? successTtl : errorTtl)
        })
        .finally(() => {
          if (inflight.get(id)?.task === task) inflight.delete(id)
        })
      inflight.set(id, { identity, task })
      return task
    },
    /** The last snapshot of a source whose credential could not be read, marked stale. */
    preserve(id: string) {
      const cell = cells.get(id)
      return cell ? [preserveCell(id, cell)] : []
    },
    /** The last snapshots under an id prefix and one account, marked stale, for a read that could not complete. */
    preservePrefix(prefix: string, identity?: string) {
      if (identity === undefined) return []
      const hashed = createHash("sha256").update(identity).digest("hex")
      const items: ProviderUsage.UsageSnapshot[] = []
      for (const [id, cell] of cells)
        if (id.startsWith(prefix) && cell.identity === hashed) items.push(preserveCell(id, cell))
      return items
    },
    /** Drops the cached sources under an id prefix that are no longer part of the answer. */
    prunePrefix(prefix: string, keep: readonly string[]) {
      prune(prefix, keep)
    },
    /**
     * One load at a time of the Kilo managed account and its plans. A failed part keeps the previous answer, so a
     * transient read failure never empties the plan list. A new identity first drops the cached managed quotas of
     * the previous one.
     */
    cloud(identity: string, force: boolean, load: () => Promise<CloudState>) {
      // A cached answer belongs to one account: never answer another account with it.
      if (cloud.value && cloud.value.identity !== identity) {
        cloud.value = undefined
        prune(managedPrefix, [])
      }
      if (!force && cloud.value?.identity === identity && cloud.expires > now())
        return Promise.resolve(cloud.value)
      // A load of another account must not answer this one: start a separate load.
      if (cloud.inflight?.identity === identity) return cloud.inflight.task
      const cell = cloud
      // The same identity, because a different identity cleared the previous value above.
      const previous = cell.value
      const finished = load()
        .then((state) => {
          const next = { identity, ...state }
          // A signed-out read cleared the entry while this load ran: answer without caching it.
          if (cloud !== cell) return next
          const failed = !next.plans.ok || !next.byok.ok
          const value = failed && previous ? previous : next
          cloud = { value, expires: now() + (failed ? errorTtl : successTtl) }
          return value
        })
        .finally(() => {
          if (cell.inflight?.task === finished) delete cell.inflight
        })
      cell.inflight = { identity, task: finished }
      return finished
    },
    /** A signed-out or team account has no managed plans: drop the cloud answer and every cached quota. */
    clearManaged() {
      cloud = { expires: 0 }
      prune(managedPrefix, [])
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
  return {
    ...previous,
    fetchState: "stale" as const,
    planState: next.planState,
    routingState: next.routingState,
    managementUrl: next.managementUrl,
    error: next.error,
  }
}
