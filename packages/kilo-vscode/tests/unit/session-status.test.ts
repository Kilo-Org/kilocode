import { describe, it, expect } from "bun:test"
import { seedSessionStatuses, seedSessionWakeups } from "../../src/session-status"
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

  // ---- reconcile=false (SSE reconnect) ----

  it("skips reconciliation when reconcile=false", async () => {
    const client = createClient({ data: {} })
    const map = new Map<string, SessionStatus["type"]>([["s1", "busy"]])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post, false)

    // Session stays busy — reconciliation skipped on SSE reconnect
    expect(map.get("s1")).toBe("busy")
    expect(msgs).toEqual([])
  })

  it("still seeds server entries when reconcile=false", async () => {
    const client = createClient({
      data: { s1: { type: "busy" }, s2: { type: "retry", attempt: 1, message: "err", next: 1000 } },
    })
    const map = new Map<string, SessionStatus["type"]>()
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post, false)

    expect(map.get("s1")).toBe("busy")
    expect(map.get("s2")).toBe("retry")
    expect(msgs).toEqual([
      { type: "sessionStatus", sessionID: "s1", status: "busy" },
      { type: "sessionStatus", sessionID: "s2", status: "retry", attempt: 1, message: "err", next: 1000 },
    ])
  })

  it("does not reset stale entries when reconcile=false but updates confirmed ones", async () => {
    const client = createClient({ data: { confirmed: { type: "busy" } } })
    const map = new Map<string, SessionStatus["type"]>([
      ["stale", "busy"],
      ["confirmed", "retry"],
    ])
    const { msgs, post } = collect()

    await seedSessionStatuses(client, "/repo", map, post, false)

    // stale: stays busy (no reconciliation)
    expect(map.get("stale")).toBe("busy")
    // confirmed: updated to busy from server
    expect(map.get("confirmed")).toBe("busy")
    expect(msgs).toEqual([{ type: "sessionStatus", sessionID: "confirmed", status: "busy" }])
  })
})

// ---------------------------------------------------------------------------
// seedSessionWakeups
// ---------------------------------------------------------------------------

type WakeupResult = { data: Array<{ sessionID: string; pending: number }> | null } | Error

function createWakeupClient(byDirectory: Record<string, WakeupResult>) {
  return {
    kilocode: {
      wakeups: async (params: { directory: string }) => {
        const result = byDirectory[params.directory]
        if (result === undefined) return { data: [] }
        if (result instanceof Error) throw result
        return result
      },
    },
  } as unknown as Parameters<typeof seedSessionWakeups>[0]
}

describe("seedSessionWakeups", () => {
  it("posts a wakeup per session and returns the seen sessions", async () => {
    const client = createWakeupClient({
      "/repo": {
        data: [
          { sessionID: "s1", pending: 1 },
          { sessionID: "s2", pending: 3 },
        ],
      },
    })
    const { msgs, post } = collect()

    const { seen, complete } = await seedSessionWakeups(client, ["/repo"], post)

    expect(msgs).toEqual([
      { type: "sessionWakeup", sessionID: "s1", pending: 1 },
      { type: "sessionWakeup", sessionID: "s2", pending: 3 },
    ])
    expect([...seen]).toEqual(["s1", "s2"])
    expect(complete).toBe(true)
  })

  it("reports an incomplete result when one directory fails", async () => {
    const client = createWakeupClient({
      "/bad": new Error("connection refused"),
      "/good": { data: [{ sessionID: "s3", pending: 2 }] },
    })
    const { msgs, post } = collect()

    const { seen, complete } = await seedSessionWakeups(client, ["/bad", "/good"], post)

    expect(msgs).toEqual([{ type: "sessionWakeup", sessionID: "s3", pending: 2 }])
    expect([...seen]).toEqual(["s3"])
    expect(complete).toBe(false)
  })

  it("skips sessions rejected by the accept filter", async () => {
    const client = createWakeupClient({
      "/repo": {
        data: [
          { sessionID: "keep", pending: 1 },
          { sessionID: "drop", pending: 1 },
        ],
      },
    })
    const { msgs, post } = collect()

    const { seen, complete } = await seedSessionWakeups(client, ["/repo"], post, (sessionID) => sessionID === "keep")

    expect(msgs).toEqual([{ type: "sessionWakeup", sessionID: "keep", pending: 1 }])
    expect([...seen]).toEqual(["keep"])
    expect(complete).toBe(true)
  })

  it("handles null data as no wakeups", async () => {
    const client = createWakeupClient({ "/repo": { data: null } })
    const { msgs, post } = collect()

    const { seen, complete } = await seedSessionWakeups(client, ["/repo"], post)

    expect(msgs).toEqual([])
    expect([...seen]).toEqual([])
    expect(complete).toBe(true)
  })
})
