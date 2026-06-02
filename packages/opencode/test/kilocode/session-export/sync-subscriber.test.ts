import { describe, test, expect } from "bun:test"
import { SyncSubscriber } from "@/kilocode/session-export/sync-subscriber"

describe("SyncSubscriber", () => {
  test("emits tool_executed for tool completion events on eligible sessions", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => true,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 0,
      syncSeq: () => 1,
    })
    sub.onSyncEvent({
      type: "message.part.updated",
      aggregateID: "s1",
      seq: 5,
      data: {
        part: {
          type: "tool",
          state: { status: "completed", input: { path: "a.ts" }, output: "ok", time: { start: 1, end: 4 } },
          callID: "c1",
          tool: "read_file",
        },
      },
    })
    const tool = posted.find((item) => (item as { type?: string }).type === "tool_executed") as
      | { toolName: string; toolOutput?: string }
      | undefined
    expect(tool?.toolName).toBe("read_file")
    expect(tool?.toolOutput).toBe("ok")
  })

  test("skips events for ineligible sessions", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => false,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 0,
      syncSeq: () => 1,
    })
    sub.onSyncEvent({
      type: "message.part.updated",
      aggregateID: "s1",
      seq: 5,
      data: { part: { type: "tool", state: { status: "completed" }, callID: "c1", tool: "x" } },
    })
    expect(posted.length).toBe(0)
  })

  test("folds terminal outcome into bash tool events", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => true,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 0,
      syncSeq: () => 1,
    })
    sub.onSyncEvent({
      type: "message.part.updated",
      aggregateID: "s1",
      seq: 5,
      data: {
        part: {
          type: "tool",
          state: { status: "completed", input: {}, output: "ok", metadata: { exit: 2 }, time: { start: 1, end: 5 } },
          callID: "c1",
          tool: "bash",
        },
      },
    })
    const tool = posted.find((item) => (item as { type?: string }).type === "tool_executed") as
      | { exitCode?: number; signal?: string }
      | undefined
    expect(tool?.exitCode).toBe(2)
    expect(posted.some((item) => (item as { type?: string }).type === "terminal_outcome")).toBe(false)
  })

  test("uses getRootSessionId so sub-agent events keep their root linkage", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => true,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 0,
      syncSeq: () => 1,
      getRootSessionId: (sessionId) => (sessionId === "sub_1" ? "root_1" : sessionId),
    })
    sub.onSyncEvent({
      type: "message.part.updated",
      aggregateID: "sub_1",
      seq: 5,
      data: {
        part: {
          type: "tool",
          state: { status: "completed", input: {}, output: "ok", metadata: { exit: 0 }, time: { start: 1, end: 5 } },
          callID: "c1",
          tool: "bash",
        },
      },
    })
    sub.onSyncEvent({
      type: "permission.replied",
      aggregateID: "sub_1",
      data: { permission: "write_file", reply: "once" },
    })
    sub.onSyncEvent({
      type: "session.feedback",
      aggregateID: "sub_1",
      data: { messageID: "m1", rating: "up" },
    })
    const roots = posted.map((item) => (item as { rootSessionId?: string }).rootSessionId)
    expect(roots.every((root) => root === "root_1")).toBe(true)
  })

  test("correlates permission replies with prior requests", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => true,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 10,
      syncSeq: () => 1,
    })
    sub.onSyncEvent({
      type: "permission.asked",
      aggregateID: "s1",
      data: { id: "p1", permission: "write_file" },
    })
    sub.onSyncEvent({
      type: "permission.replied",
      aggregateID: "s1",
      data: { requestID: "p1", reply: "always" },
    })

    const event = posted.find((item) => (item as { type?: string }).type === "permission_decided") as
      | { toolName?: string; decision?: string }
      | undefined
    expect(event?.toolName).toBe("write_file")
    expect(event?.decision).toBe("always_allow")
  })

  test("turnId groups tool events with the active session turn", () => {
    const posted: unknown[] = []
    const sub = new SyncSubscriber({
      isEligibleSession: () => true,
      dispatch: (event) => posted.push(event),
      agentVersion: "v0",
      now: () => 0,
      syncSeq: () => 1,
      getTurnId: () => "u1",
    })
    sub.onSyncEvent({
      type: "message.part.updated",
      aggregateID: "s1",
      seq: 5,
      data: {
        part: {
          type: "tool",
          state: { status: "completed", input: {}, output: "ok", metadata: { exit: 0 }, time: { start: 1, end: 5 } },
          callID: "c1",
          tool: "bash",
        },
      },
    })
    expect(posted.every((item) => (item as { turnId?: string }).turnId === "u1")).toBe(true)
  })
})
