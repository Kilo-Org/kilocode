import { describe, expect, test } from "bun:test"
import {
  consumeManagedBatch,
  enqueueManaged,
  shouldWakeCoordinator,
  unconsumedManaged,
} from "../session-inbox"
import { FOUNDATION_EVENT, FOUNDATION_WAKE_TYPES, type ManagedEvent } from "../types"

type GenericType = "CHILD_DONE" | "HEARTBEAT"

function event(type: GenericType, id: string, createdAt: string): ManagedEvent<GenericType> {
  return {
    id,
    type,
    payload: {},
    createdAt,
  }
}

function key(item: ManagedEvent<GenericType>): string {
  return `${item.type}:${item.payload["job"] ?? ""}`
}

describe("foundation session inbox", () => {
  test("dedupes unconsumed events by caller key without product types", () => {
    const items: ManagedEvent<GenericType>[] = []
    const first = event("CHILD_DONE", "a", "2026-08-16T10:00:00.000Z")
    first.payload = { job: "1" }
    const duplicate = event("CHILD_DONE", "b", "2026-08-16T10:00:01.000Z")
    duplicate.payload = { job: "1" }

    enqueueManaged(items, first, key)
    enqueueManaged(items, duplicate, key)

    expect(unconsumedManaged(items)).toHaveLength(1)
    expect(unconsumedManaged(items)[0]?.id).toBe("a")
  })

  test("consumeManagedBatch marks the oldest events consumed", () => {
    const items: ManagedEvent<GenericType>[] = []
    const older = event("CHILD_DONE", "old", "2026-08-16T10:00:00.000Z")
    const newer = event("CHILD_DONE", "new", "2026-08-16T10:00:01.000Z")
    enqueueManaged(items, newer, (item) => item.id)
    enqueueManaged(items, older, (item) => item.id)

    const batch = consumeManagedBatch(items, 1, "2026-08-16T11:00:00.000Z")
    expect(batch[0]?.id).toBe("old")
    expect(batch[0]?.consumedAt).toBe("2026-08-16T11:00:00.000Z")
    expect(unconsumedManaged(items)[0]?.id).toBe("new")
  })

  test("wake policy is a caller-supplied set", () => {
    const wake = new Set<GenericType>(["CHILD_DONE"])
    expect(shouldWakeCoordinator("CHILD_DONE", wake)).toBe(true)
    expect(shouldWakeCoordinator("HEARTBEAT", wake)).toBe(false)
    expect(shouldWakeCoordinator(FOUNDATION_EVENT.MESSAGE_RECEIVED, FOUNDATION_WAKE_TYPES)).toBe(true)
    expect(shouldWakeCoordinator(FOUNDATION_EVENT.STALLED, FOUNDATION_WAKE_TYPES)).toBe(true)
    expect(shouldWakeCoordinator(FOUNDATION_EVENT.STATUS_CHANGED, FOUNDATION_WAKE_TYPES)).toBe(false)
  })
})
