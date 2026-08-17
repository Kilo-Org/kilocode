import type { ManagedEvent } from "./types"

function unconsumedOf<T extends ManagedEvent>(items: T[]): T[] {
  return items.filter((event) => event.consumedAt === undefined)
}

export function enqueueManaged<T extends ManagedEvent>(items: T[], event: T, keyFn: (event: T) => string): void {
  const key = keyFn(event)
  const alreadyQueued = unconsumedOf(items).some((candidate) => keyFn(candidate) === key)
  if (alreadyQueued) {
    return
  }
  items.push(event)
}

export function consumeManagedBatch<T extends ManagedEvent>(
  items: T[],
  limit = 10,
  nowIso = new Date().toISOString(),
): T[] {
  const pending = unconsumedOf(items).sort((left, right) => {
    const byCreated = left.createdAt.localeCompare(right.createdAt)
    return byCreated !== 0 ? byCreated : left.id.localeCompare(right.id)
  })
  const batch = pending.slice(0, Math.max(0, limit))
  for (const event of batch) {
    event.consumedAt = nowIso
  }
  return batch
}

export function unconsumedManaged<T extends ManagedEvent>(items: T[]): T[] {
  return unconsumedOf(items)
}

/** Drop consumed events in place so the inbox cannot grow without bound. */
export function compactConsumed<T extends ManagedEvent>(items: T[]): void {
  const pending = items.filter((event) => event.consumedAt === undefined)
  items.splice(0, items.length, ...pending)
}

/** Drop every event for a session in place (closed/deleted session). */
export function forgetManagedSession<T extends ManagedEvent>(items: T[], sessionId: string): void {
  const remaining = items.filter((event) => event.sessionId !== sessionId)
  items.splice(0, items.length, ...remaining)
}

export function shouldWakeCoordinator<TType extends string>(eventType: TType, wakeTypes: ReadonlySet<TType>): boolean {
  return wakeTypes.has(eventType)
}
