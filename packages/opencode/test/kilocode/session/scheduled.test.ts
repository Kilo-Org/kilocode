import { describe, expect, test } from "bun:test"
import { SessionID } from "@/session/schema"
import type { SessionStatus } from "@/session/status"
import {
  futureDue,
  futureDueFor,
  mergeScheduled,
  resolveDerivedSessionStatus,
  scheduledInfo,
} from "@/kilocode/session/scheduled"

const id = (value: string) => SessionID.make(value)

describe("futureDue", () => {
  test("keeps a future wakeup, drops a past one and takes the earliest per session", () => {
    const now = 1_000
    const a = id("ses_a")
    const b = id("ses_b")
    const due = futureDue(
      [
        { sessionID: a, dueAt: now + 5_000 },
        { sessionID: a, dueAt: now + 1_000 },
        { sessionID: a, dueAt: now },
        { sessionID: b, dueAt: now - 1 },
      ],
      now,
    )
    expect(due.get(a)).toBe(now + 1_000)
    expect(due.has(b)).toBe(false)
    expect(due.size).toBe(1)
  })

  test("an empty input yields an empty map", () => {
    expect(futureDue([], 1_000).size).toBe(0)
  })
})

// The session list reads persisted wakeups in its own process, so it must select
// the sessions it displays rather than trust an adopted, directory-scoped view.
describe("futureDueFor", () => {
  test("keeps only the listed session's future wakeup", () => {
    const now = 1_000
    const listed = id("ses_listed")
    const other = id("ses_other")
    const due = futureDueFor(
      [
        { sessionID: listed, dueAt: now + 5_000 },
        { sessionID: other, dueAt: now + 1_000 },
      ],
      [String(listed)],
      now,
    )
    expect([...due.keys()]).toEqual([listed])
    expect(due.get(listed)).toBe(now + 5_000)
  })

  test("takes the earliest future wakeup per listed session and drops a past one", () => {
    const now = 1_000
    const listed = id("ses_listed")
    const due = futureDueFor(
      [
        { sessionID: listed, dueAt: now + 5_000 },
        { sessionID: listed, dueAt: now + 1_000 },
        { sessionID: listed, dueAt: now },
      ],
      [String(listed)],
      now,
    )
    expect(due.get(listed)).toBe(now + 1_000)
  })

  test("a persisted wakeup folds into `scheduled` for a listed session", () => {
    const now = 1_000
    const listed = id("ses_listed")
    const wakeups = [{ sessionID: listed, dueAt: now + 5_000 }]
    const merged = mergeScheduled({}, futureDueFor(wakeups, [String(listed)], now))
    expect(merged[String(listed)]).toEqual({ type: "scheduled", scheduledAt: new Date(now + 5_000).toISOString() })
  })
})

describe("scheduledInfo", () => {
  test("carries the wake time as an ISO-8601 string on the scheduled variant", () => {
    const due = 1_700_000_000_000
    expect(scheduledInfo(due)).toEqual({ type: "scheduled", scheduledAt: new Date(due).toISOString() })
  })
})

describe("mergeScheduled", () => {
  test("adds a scheduled entry for a future wakeup", () => {
    const a = id("ses_a")
    const merged = mergeScheduled({}, new Map([[a, 5_000]]))
    expect(merged[String(a)]).toEqual({ type: "scheduled", scheduledAt: new Date(5_000).toISOString() })
  })

  test("no wakeup leaves the map unchanged", () => {
    const base: Record<string, SessionStatus.Info> = { [String(id("ses_a"))]: { type: "busy" } }
    expect(mergeScheduled(base, new Map())).toEqual(base)
  })

  test("a stored status wins over a future wakeup", () => {
    const a = id("ses_a")
    const base: Record<string, SessionStatus.Info> = { [String(a)]: { type: "busy" } }
    expect(mergeScheduled(base, new Map([[a, 5_000]]))[String(a)]).toEqual({ type: "busy" })
  })
})

describe("resolveDerivedSessionStatus", () => {
  test("permission and question keep their precedence over a wakeup", () => {
    expect(
      resolveDerivedSessionStatus({
        hasPermission: true,
        hasQuestion: true,
        statusType: "busy",
        scheduledAt: 5_000,
      }),
    ).toBe("permission")
    expect(
      resolveDerivedSessionStatus({
        hasPermission: false,
        hasQuestion: true,
        statusType: "busy",
        scheduledAt: 5_000,
      }),
    ).toBe("question")
  })

  test("scheduled only with a wakeup due and no live turn", () => {
    expect(
      resolveDerivedSessionStatus({
        hasPermission: false,
        hasQuestion: false,
        statusType: undefined,
        scheduledAt: 5_000,
      }),
    ).toBe("scheduled")
    expect(
      resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "idle", scheduledAt: 5_000 }),
    ).toBe("scheduled")
    expect(
      resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "busy", scheduledAt: 5_000 }),
    ).toBe("busy")
    expect(
      resolveDerivedSessionStatus({
        hasPermission: false,
        hasQuestion: false,
        statusType: "retry",
        scheduledAt: 5_000,
      }),
    ).toBe("retry")
    expect(
      resolveDerivedSessionStatus({
        hasPermission: false,
        hasQuestion: false,
        statusType: "offline",
        scheduledAt: 5_000,
      }),
    ).toBe("retry")
  })

  test("every existing result is unchanged without a wakeup", () => {
    expect(resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: undefined })).toBe(
      "idle",
    )
    expect(resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "idle" })).toBe("idle")
    expect(resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "busy" })).toBe("busy")
    expect(resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "retry" })).toBe("retry")
    expect(resolveDerivedSessionStatus({ hasPermission: false, hasQuestion: false, statusType: "offline" })).toBe(
      "retry",
    )
  })
})
