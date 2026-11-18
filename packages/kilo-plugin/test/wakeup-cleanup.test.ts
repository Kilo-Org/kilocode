import { describe, expect, test } from "bun:test"
import { cleanup } from "../src/wakeup"

const changed = (goal: { status?: string } | null) => ({
  type: "rpc.opencode.goal.changed",
  data: { sessionID: "ses_1", goal: goal as never },
})

describe("wakeup cleanup events", () => {
  test("a deleted session retires its tasks", () => {
    expect(cleanup({ type: "session.deleted", data: { sessionID: "ses_1" } })).toBe("ses_1")
  })

  test("an active goal keeps its tasks", () => {
    expect(cleanup(changed({ status: "active" }))).toBeUndefined()
  })

  test("a finished, paused or cleared goal retires its tasks", () => {
    expect(cleanup(changed({ status: "complete" }))).toBe("ses_1")
    expect(cleanup(changed({ status: "paused" }))).toBe("ses_1")
    expect(cleanup(changed(null))).toBe("ses_1")
  })

  test("other events and payloads are ignored", () => {
    expect(cleanup({ type: "session.status", data: { sessionID: "ses_1" } })).toBeUndefined()
    expect(cleanup({ type: "session.deleted", data: {} })).toBeUndefined()
    expect(cleanup({ type: "rpc.opencode.goal.changed", data: null })).toBeUndefined()
  })
})
