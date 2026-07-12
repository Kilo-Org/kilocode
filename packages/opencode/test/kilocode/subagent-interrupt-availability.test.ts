import { describe, expect, test } from "bun:test"
import { Interrupt } from "../../src/kilocode/interrupt"

const childID = "child-1"
const parentID = "parent-1"
const messages = [{ id: "msg-1" }]

describe("kilocode subagent interrupt availability", () => {
  test("busy status with an active foreground task is available", () => {
    expect(Interrupt.available("busy", true)).toBe(true)
  })

  test("idle status with an active foreground task is available", () => {
    expect(Interrupt.available("idle", true)).toBe(true)
  })

  test("missing status with an active foreground task is available", () => {
    expect(Interrupt.available(undefined, true)).toBe(true)
  })

  test("busy status without an active foreground task is available", () => {
    expect(Interrupt.available("busy", false)).toBe(true)
  })

  test("idle status without an active foreground task is unavailable", () => {
    expect(Interrupt.available("idle", false)).toBe(false)
  })

  test("missing status without an active foreground task is unavailable", () => {
    expect(Interrupt.available(undefined, false)).toBe(false)
  })

  test("a running parent task part keeps interrupt available after child status becomes idle", () => {
    const active = Interrupt.foregroundTaskActive({
      childID,
      parentID,
      messages,
      parts: {
        "msg-1": [
          {
            type: "tool",
            tool: "task",
            state: {
              status: "running",
              metadata: {
                sessionId: childID,
              },
            },
          },
        ],
      },
    })

    expect(active).toBe(true)
    expect(Interrupt.available("idle", active)).toBe(true)
  })

  test("once the parent task part is completed interrupt becomes unavailable", () => {
    const active = Interrupt.foregroundTaskActive({
      childID,
      parentID,
      messages,
      parts: {
        "msg-1": [
          {
            type: "tool",
            tool: "task",
            state: {
              status: "completed",
              metadata: {
                sessionId: childID,
              },
            },
          },
        ],
      },
    })

    expect(active).toBe(false)
    expect(Interrupt.available(undefined, active)).toBe(false)
  })
})
