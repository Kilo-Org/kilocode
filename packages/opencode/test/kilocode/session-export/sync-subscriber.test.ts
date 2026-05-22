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
        part: { type: "tool", state: { status: "completed", input: { path: "a.ts" }, output: "ok", time: { start: 1, end: 4 } }, callID: "c1", tool: "read_file" },
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

  test("emits terminal_outcome for bash tools", () => {
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
    expect(posted.some((item) => (item as { type?: string }).type === "terminal_outcome")).toBe(true)
  })
})
