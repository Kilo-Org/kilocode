import type { SessionMessage } from "@kilocode/sdk/v2"

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function keyed(value: unknown[]): value is Array<Record<string, unknown> & { id: string }> {
  return value.every((item) => record(item) && typeof item.id === "string")
}

function merge(base: unknown, snapshot: unknown, live: unknown): unknown {
  if (same(live, base)) return snapshot
  if (same(snapshot, base)) return live
  if (snapshot === undefined) return live
  if (live === undefined) return snapshot

  if (Array.isArray(snapshot) && Array.isArray(live)) {
    const prior = Array.isArray(base) ? base : []
    if (!keyed(snapshot) || !keyed(live) || !keyed(prior)) return snapshot
    const before = new Map(prior.map((item) => [item.id, item]))
    const update = new Map(live.map((item) => [item.id, item]))
    const result = snapshot.map((item) => {
      const next = update.get(item.id)
      return next ? merge(before.get(item.id), item, next) : item
    })
    const ids = new Set(snapshot.map((item) => item.id))
    result.push(...live.filter((item) => !ids.has(item.id)))
    return result
  }

  if (record(snapshot) && record(live)) {
    const prior = record(base) ? base : {}
    const result: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(snapshot), ...Object.keys(live)])) {
      result[key] = merge(prior[key], snapshot[key], live[key])
    }
    return result
  }

  if (typeof snapshot === "string" && typeof live === "string") {
    if (snapshot.startsWith(live)) return snapshot
    if (live.startsWith(snapshot)) return live
  }
  return snapshot
}

export function hydrate(before: SessionMessage[], snapshot: SessionMessage[], live: SessionMessage[]) {
  const base = new Map(before.map((item) => [item.id, item]))
  const latest = new Map(live.map((item) => [item.id, item]))
  const changed = new Set(live.filter((item) => !same(item, base.get(item.id))).map((item) => item.id))
  const ids = new Set(snapshot.map((item) => item.id))
  const result = snapshot.map((item) => {
    const update = latest.get(item.id)
    if (!update || !changed.has(item.id)) return item
    return merge(base.get(item.id), item, update) as SessionMessage
  })

  for (const item of live) {
    if (!changed.has(item.id) || ids.has(item.id)) continue
    const index = result.findIndex((entry) => entry.time.created < item.time.created)
    if (index === -1) {
      result.push(item)
      continue
    }
    result.splice(index, 0, item)
  }
  return result
}
