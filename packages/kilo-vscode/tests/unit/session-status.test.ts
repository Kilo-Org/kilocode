import { describe, it, expect } from "bun:test"
import { seedSessionStatuses, getBusySessionCount } from "../../src/session-status"
import type { SessionStatus } from "@kilocode/sdk/v2/client"

/**
 * Minimal fake client that satisfies the KiloClient.session.status() call.
 * Returns controlled data or throws to simulate server errors.
 */
function createClient(response: { data: Record<string, SessionStatus> | null } | Error) {
  return {
    session: {
      status: async (_params: { directory: string }) => {
        if (response instanceof Error) throw response
        return response
      },
    },
  } as Parameters<typeof seedSessionStatuses>[0]
}

function collect() {
  const msgs: unknown[] = []
  return { msgs, post: (msg: unknown) => msgs.push(msg) }
}

// ---------------------------------------------------------------------------
// seedSessionStatuses
// ---------------------------------------------------------------------------

describe("seedSessionStatuses", () => {
  it("seeds map and posts messages for non-idle sessions", async () => {
    const client = createClient({
      data: {
        s1: { type: "busy" },
        s2: { type: "retry", attempt: 3, message: "rate limited", next: 5000 },
      },
    })
    const map = new Map<string, SessionStatus["type"]>()
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    expect(map.get("s1")).toBe("busy")
    expect(map.get("s2")).toBe("retry")
    expect(msgs).toEqual([
      { type: "sessionStatus", sessionID: "s1", status: "busy" },
      { type: "sessionStatus", sessionID: "s2", status: "retry", attempt: 3, message: "rate limited", next: 5000 },
    ])
  })

  // ---- THE BUG: stale entries not cleared on reconnect ----

  it("clears stale busy entries absent from server response", async () => {
    const client = createClient({ data: {} })
    const map = new Map<string, SessionStatus["type"]>([["s1", "busy"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    expect(map.get("s1")).toBe("idle")
    expect(msgs).toEqual([{ type: "sessionStatus", sessionID: "s1", status: "idle" }])
  })

  it("clears stale retry entries absent from server response", async () => {
    const client = createClient({ data: {} })
    const map = new Map<string, SessionStatus["type"]>([["s1", "retry"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    expect(map.get("s1")).toBe("idle")
    expect(msgs).toEqual([{ type: "sessionStatus", sessionID: "s1", status: "idle" }])
  })

  it("preserves entries that server confirms as still active", async () => {
    const client = createClient({ data: { s1: { type: "busy" } } })
    const map = new Map<string, SessionStatus["type"]>([["s1", "busy"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    expect(map.get("s1")).toBe("busy")
    expect(msgs).toEqual([{ type: "sessionStatus", sessionID: "s1", status: "busy" }])
  })

  it("does not send redundant idle for already-idle entries", async () => {
    const client = createClient({ data: {} })
    const map = new Map<string, SessionStatus["type"]>([["s1", "idle"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    // Already idle — no message should be posted
    expect(msgs).toEqual([])
    expect(map.get("s1")).toBe("idle")
  })

  it("handles mixed: some stale, some confirmed, some new", async () => {
    const client = createClient({
      data: {
        confirmed: { type: "busy" },
        fresh: { type: "busy" },
      },
    })
    const map = new Map<string, SessionStatus["type"]>([
      ["stale", "busy"],
      ["confirmed", "retry"],
    ])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    // stale: was busy locally, absent from server → idle
    expect(map.get("stale")).toBe("idle")
    // confirmed: was retry locally, server says busy → busy
    expect(map.get("confirmed")).toBe("busy")
    // fresh: new from server → busy
    expect(map.get("fresh")).toBe("busy")
    // Messages: server entries first (confirmed, fresh), then stale reconciliation
    expect(msgs).toEqual([
      { type: "sessionStatus", sessionID: "confirmed", status: "busy" },
      { type: "sessionStatus", sessionID: "fresh", status: "busy" },
      { type: "sessionStatus", sessionID: "stale", status: "idle" },
    ])
  })

  it("handles server error gracefully — no map changes", async () => {
    const client = createClient(new Error("connection refused"))
    const map = new Map<string, SessionStatus["type"]>([["s1", "busy"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    // Map unchanged on error — conservative behavior
    expect(map.get("s1")).toBe("busy")
    expect(msgs).toEqual([])
  })

  it("handles null data response — no map changes", async () => {
    const client = createClient({ data: null })
    const map = new Map<string, SessionStatus["type"]>([["s1", "busy"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post)

    // Null data could mean a non-2xx response (401/500), not "no active sessions".
    // Conservative: leave map unchanged to avoid false-clearing busy sessions.
    expect(map.get("s1")).toBe("busy")
    expect(msgs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getBusySessionCount
// ---------------------------------------------------------------------------

describe("getBusySessionCount", () => {
  it("returns 0 for empty map", () => {
    expect(getBusySessionCount(new Map())).toBe(0)
  })

  it("counts only busy entries, not idle or retry", () => {
    const map = new Map<string, SessionStatus["type"]>([
      ["a", "busy"],
      ["b", "idle"],
      ["c", "retry"],
      ["d", "busy"],
    ])
    expect(getBusySessionCount(map)).toBe(2)
  })
})
