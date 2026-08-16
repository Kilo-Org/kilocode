import { afterEach, describe, expect, test } from "bun:test"
import { FOUNDATION_EVENT } from "@kilocode/kilo-foundation"
import { managedInbox } from "../../src/agent-manager/managed-delivery"
import { SessionStallWatchdog, resumableAfterStall } from "../../src/agent-manager/session-stall-watchdog"

describe("session stall watchdog", () => {
  afterEach(() => {
    managedInbox.events.length = 0
    managedInbox.telemetry.stallsDetected = 0
  })

  test("does not stall an idle session", () => {
    const watchdog = new SessionStallWatchdog({ stallAfterMs: 1000 })
    watchdog.noteStatus("s1", "busy", "/repo", "2026-08-16T12:00:00.000Z")
    watchdog.noteStatus("s1", "idle", "/repo", "2026-08-16T12:00:01.000Z")
    expect(watchdog.scan("2026-08-16T12:20:00.000Z")).toEqual([])
  })

  test("enqueues SESSION_STALLED once for a silent busy session", () => {
    const stalled: Array<{ sessionId: string; resumable: boolean }> = []
    const watchdog = new SessionStallWatchdog({
      stallAfterMs: 60_000,
      onStall: (sessionId, resumable) => stalled.push({ sessionId, resumable }),
    })
    watchdog.noteStatus("s1", "busy", "/repo", "2026-08-16T12:00:00.000Z")
    const first = watchdog.scan("2026-08-16T12:02:00.000Z")
    const second = watchdog.scan("2026-08-16T12:03:00.000Z")
    expect(first.map((item) => item.sessionId)).toEqual(["s1"])
    expect(second.map((item) => item.sessionId)).toEqual(["s1"])
    expect(managedInbox.events.filter((event) => event.type === FOUNDATION_EVENT.STALLED)).toHaveLength(1)
    expect(managedInbox.telemetry.stallsDetected).toBe(1)
    expect(managedInbox.events.some((event) => event.type === FOUNDATION_EVENT.RESUMABLE)).toBe(false)
    expect(stalled).toEqual([{ sessionId: "s1", resumable: false }])
  })

  test("marks offline stalls resumable without treating busy as resumable", () => {
    expect(resumableAfterStall("running")).toBe(false)
    expect(resumableAfterStall("blocked")).toBe(true)
    const watchdog = new SessionStallWatchdog({ stallAfterMs: 60_000 })
    watchdog.noteStatus("s2", "offline", "/repo", "2026-08-16T12:00:00.000Z")
    watchdog.scan("2026-08-16T12:02:00.000Z")
    expect(managedInbox.events.some((event) => event.type === FOUNDATION_EVENT.RESUMABLE)).toBe(true)
  })
})
