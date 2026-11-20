import { describe, expect, test } from "bun:test"
import { StatusSync } from "../../../src/kilo-sessions/status-sync"

const night = "2026-10-15T07:59:59.900Z"
const morning = "2026-10-15T08:00:00.100Z"

describe("session status occurrence", () => {
  test("historical snapshots and same-state observations keep an unknown onset unknown", async () => {
    const statuses = StatusSync.create()
    expect(await statuses.snapshot("old", async () => ({ status: "question" }))).toEqual({ status: "question" })
    expect(statuses.record("old", { status: "question" }, morning)).toEqual({ status: "question" })
    expect(await statuses.snapshot("old", async () => ({ status: "question" }))).toEqual({ status: "question" })
  })

  test("records a true transition before transport and reuses its entire identity", async () => {
    const statuses = StatusSync.create()
    await statuses.snapshot("live", async () => ({ status: "busy" }))
    const first = statuses.record("live", { status: "question" }, night)
    expect(first).toMatchObject({ status: "question", occurredAt: night, previousStatus: "busy" })
    expect(first.transitionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    expect(statuses.record("live", { status: "question" }, morning)).toEqual(first)
    expect(await statuses.snapshot("live", async () => ({ status: "question" }))).toEqual(first)
  })

  test("an observed first state has no fabricated previous state", () => {
    const statuses = StatusSync.create()
    expect(statuses.record("new", { status: "permission" }, night)).toMatchObject({
      status: "permission",
      occurredAt: night,
      previousStatus: null,
    })
  })

  test("retains every rapid transition and orders same-millisecond identities", () => {
    const statuses = StatusSync.create()
    const records = (["question", "permission", "idle", "question"] as const).map((status) =>
      statuses.record("rapid", { status }, night),
    )
    expect(records.map((record) => record.previousStatus)).toEqual([null, "question", "permission", "idle"])
    expect(records.map((record) => record.occurredAt)).toEqual([night, night, night, night])
    const ids = records.map((record) => record.transitionId)
    expect(new Set(ids).size).toBe(4)
    expect(ids).toEqual([...ids].sort())
  })

  test("a changed wakeup due time does not restart the scheduled status occurrence", () => {
    const statuses = StatusSync.create()
    const first = statuses.record("scheduled", { status: "scheduled", scheduledAt: morning }, night)
    expect(
      statuses.record("scheduled", { status: "scheduled", scheduledAt: "2026-10-16T08:00:00.000Z" }, morning),
    ).toEqual({
      ...first,
      scheduledAt: "2026-10-16T08:00:00.000Z",
    })
  })

  test("an async full sync cannot replace a newer source event with its stale sampled state", async () => {
    const statuses = StatusSync.create()
    statuses.record("racing", { status: "busy" }, night)
    const pending = Promise.withResolvers<StatusSync.Derived>()
    const snapshot = statuses.snapshot("racing", () => pending.promise)
    const latest = statuses.record("racing", { status: "question" }, morning)
    pending.resolve({ status: "busy" })
    expect(await snapshot).toEqual(latest)
    expect(await statuses.snapshot("racing", async () => ({ status: "question" }))).toEqual(latest)
  })

  test("an initial full sync cannot erase the event observed while it was loading", async () => {
    const statuses = StatusSync.create()
    const pending = Promise.withResolvers<StatusSync.Derived>()
    const snapshot = statuses.snapshot("startup", () => pending.promise)
    const latest = statuses.record("startup", { status: "question" }, night)
    pending.resolve({ status: "idle" })
    expect(await snapshot).toEqual(latest)
  })

  test("a snapshot-only change does not invent an event time or reuse an old onset", async () => {
    const statuses = StatusSync.create()
    statuses.record("missed", { status: "question" }, night)
    expect(await statuses.snapshot("missed", async () => ({ status: "busy" }))).toEqual({ status: "busy" })
    expect(statuses.record("missed", { status: "permission" }, morning)).toMatchObject({
      occurredAt: morning,
      previousStatus: "busy",
    })
  })

  test("a failed full sync leaves the original transition available for retry", async () => {
    const statuses = StatusSync.create()
    const first = statuses.record("retry", { status: "question" }, night)
    await expect(
      statuses.snapshot("retry", async () => {
        throw new Error("read failed")
      }),
    ).rejects.toThrow("read failed")
    expect(await statuses.snapshot("retry", async () => ({ status: "question" }))).toEqual(first)
  })

  test("session deletion forgets its occurrence without affecting another session", async () => {
    const statuses = StatusSync.create()
    statuses.record("deleted", { status: "question" }, night)
    const kept = statuses.record("kept", { status: "permission" }, night)
    statuses.delete("deleted")
    expect(await statuses.snapshot("deleted", async () => ({ status: "question" }))).toEqual({ status: "question" })
    expect(await statuses.snapshot("kept", async () => ({ status: "permission" }))).toEqual(kept)
  })

  test("a deletion during a first full sync leaves no tracked state behind", async () => {
    const statuses = StatusSync.create()
    const pending = Promise.withResolvers<StatusSync.Derived>()
    const snapshot = statuses.snapshot("gone", () => pending.promise)
    statuses.delete("gone")
    pending.resolve({ status: "idle" })
    expect(await snapshot).toEqual({ status: "idle" })
    expect(statuses.record("gone", { status: "question" }, morning)).toMatchObject({ previousStatus: null })
  })

  test("a failed first full sync leaves no tracked state behind", async () => {
    const statuses = StatusSync.create()
    await expect(
      statuses.snapshot("unread", async () => {
        throw new Error("read failed")
      }),
    ).rejects.toThrow("read failed")
    expect(statuses.record("unread", { status: "question" }, morning)).toMatchObject({ previousStatus: null })
  })

  test("an event sample keeps the status it observed when a peer full-sync sample records first", async () => {
    const statuses = StatusSync.create()
    const event = Promise.withResolvers<StatusSync.Derived>()
    const peer = Promise.withResolvers<StatusSync.Derived>()
    const observed = statuses.event("race", () => event.promise)
    const sampled = statuses.snapshot("race", () => peer.promise)
    peer.resolve({ status: "idle" })
    expect(await sampled).toEqual({ status: "idle" })
    event.resolve({ status: "permission" })
    expect(await observed).toEqual({ status: "permission" })
    expect(statuses.record("race", { status: "question" }, morning)).toMatchObject({ previousStatus: "permission" })
  })

  test("an event sample yields to a transition recorded while it sampled", async () => {
    const statuses = StatusSync.create()
    const pending = Promise.withResolvers<StatusSync.Derived>()
    const observed = statuses.event("defer", () => pending.promise)
    const latest = statuses.record("defer", { status: "busy" }, night)
    pending.resolve({ status: "idle" })
    expect(await observed).toEqual(latest)
    expect(statuses.record("defer", { status: "question" }, morning)).toMatchObject({ previousStatus: "busy" })
  })

  test("a deletion during an event sample leaves no tracked state behind", async () => {
    const statuses = StatusSync.create()
    const pending = Promise.withResolvers<StatusSync.Derived>()
    const observed = statuses.event("gone-event", () => pending.promise)
    statuses.delete("gone-event")
    pending.resolve({ status: "idle" })
    expect(await observed).toEqual({ status: "idle" })
    expect(statuses.record("gone-event", { status: "question" }, morning)).toMatchObject({ previousStatus: null })
  })
})
