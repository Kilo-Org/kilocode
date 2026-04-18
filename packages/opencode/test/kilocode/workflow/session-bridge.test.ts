import { describe, it, expect, mock, beforeEach } from "bun:test"

// Track what the bridge subscribes to
const subscriptions: Array<{ type: string; callback: Function }> = []
const mockSubscribe = mock((def: any, callback: Function) => {
  subscriptions.push({ type: def.type, callback })
  return () => {
    const idx = subscriptions.findIndex((s) => s.callback === callback)
    if (idx >= 0) subscriptions.splice(idx, 1)
  }
})

mock.module("@/bus", () => ({
  Bus: {
    subscribe: mockSubscribe,
  },
}))

mock.module("@/session", () => ({
  Session: {
    Event: {
      Updated: { type: "session.updated" },
      TurnOpen: { type: "session.turn.open" },
      TurnClose: { type: "session.turn.close" },
      Error: { type: "session.error" },
    },
  },
}))

mock.module("@/session/message-v2", () => ({
  MessageV2: {
    stream: mock(() => []),
    Event: {
      // devilcode_change - audit MA8: provide PartUpdated mock for streaming output tests.
      PartUpdated: { type: "message.part.updated" },
    },
  },
}))

const { SessionBridge } = await import("@/devilcode/workflow/session-bridge")

describe("SessionBridge", () => {
  beforeEach(() => {
    subscriptions.length = 0
    mockSubscribe.mockClear()
  })

  it("subscribes to session events on start", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")

    expect(subscriptions.length).toBeGreaterThan(0)
  })

  it("calls onStatusChange when turn closes with completed", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    expect(closeSubscription).toBeDefined()
    closeSubscription!.callback({
      properties: { sessionID: "session-001", reason: "completed" },
    })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe("completed")
  })

  it("calls onStatusChange with failed on error close", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    closeSubscription!.callback({
      properties: { sessionID: "session-001", reason: "error" },
    })

    expect(statuses).toHaveLength(1)
    expect(statuses[0].status).toBe("failed")
  })

  it("ignores events for unwatched sessions", () => {
    const statuses: Array<{ sessionId: string; status: string }> = []
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: (sid, status) => statuses.push({ sessionId: sid, status }),
    })

    bridge.watch("session-001", "task-1")

    const closeSubscription = subscriptions.find((s) => s.type === "session.turn.close")
    closeSubscription!.callback({
      properties: { sessionID: "session-999", reason: "completed" },
    })

    expect(statuses).toHaveLength(0)
  })

  it("unsubscribes on unwatch", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")
    const countBefore = subscriptions.length

    bridge.unwatch("session-001")
    expect(subscriptions.length).toBeLessThan(countBefore)
  })

  // devilcode_change - audit MA8: stream message text deltas through onOutput.
  it("emits text deltas via onOutput when PartUpdated fires for the watched session", () => {
    const lines: Array<{ sessionId: string; line: string }> = []
    const bridge = new SessionBridge({
      onOutput: (sessionId, _taskId, line) => lines.push({ sessionId, line }),
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")

    // Find the PartUpdated subscription installed by the bridge.
    const partSub = subscriptions.find((s) => s.type === "message.part.updated")
    expect(partSub).toBeDefined()

    // First update: full text becomes the first delta.
    partSub!.callback({
      properties: { part: { id: "p1", sessionID: "session-001", messageID: "m1", type: "text", text: "Hello" } },
    })
    // Second update: only the new tail is emitted.
    partSub!.callback({
      properties: {
        part: { id: "p1", sessionID: "session-001", messageID: "m1", type: "text", text: "Hello world" },
      },
    })
    // Other-session update: ignored.
    partSub!.callback({
      properties: { part: { id: "p2", sessionID: "session-other", messageID: "m2", type: "text", text: "nope" } },
    })

    expect(lines.map((l) => l.line)).toEqual(["Hello", " world"])
  })

  it("unwatchAll cleans up all subscriptions", () => {
    const bridge = new SessionBridge({
      onOutput: () => {},
      onStatusChange: () => {},
    })

    bridge.watch("session-001", "task-1")
    bridge.watch("session-002", "task-2")

    bridge.unwatchAll()
    expect(subscriptions.length).toBe(0)
  })
})
