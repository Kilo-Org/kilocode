import { describe, expect, it } from "bun:test"
import { hasActiveSession } from "@/kilocode/server/httpapi/handlers/instance-reload"
import type { SessionStatus } from "@/session/status"
import { SessionID } from "@/session/schema"

const entries = (items: [string, SessionStatus.Info][]) =>
  items.map(([k, v]) => [k as SessionID, v] as [SessionID, SessionStatus.Info])

describe("instance-reload hasActiveSession", () => {
  it("returns false for an empty map", () => {
    expect(hasActiveSession(new Map(entries([])))).toBe(false)
  })

  it("returns false when all sessions are idle", () => {
    expect(
      hasActiveSession(
        new Map(
          entries([
            ["s1", { type: "idle" }],
            ["s2", { type: "idle" }],
          ]),
        ),
      ),
    ).toBe(false)
  })

  it("returns true when a session is busy", () => {
    expect(
      hasActiveSession(
        new Map(
          entries([
            ["s1", { type: "idle" }],
            ["s2", { type: "busy" }],
          ]),
        ),
      ),
    ).toBe(true)
  })

  it("returns true when a session is retrying", () => {
    expect(
      hasActiveSession(
        new Map(
          entries([
            ["s1", { type: "idle" }],
            ["s2", { type: "retry", attempt: 1, message: "retrying", next: 0 }],
          ]),
        ),
      ),
    ).toBe(true)
  })

  it("returns true when a session is offline", () => {
    expect(
      hasActiveSession(
        new Map(
          entries([
            ["s1", { type: "idle" }],
            ["s2", { type: "offline", requestID: "q1" as never, message: "waiting" }],
          ]),
        ),
      ),
    ).toBe(true)
  })
})
