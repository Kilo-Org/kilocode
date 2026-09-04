import { describe, expect, it } from "bun:test"
import { closeAllTasks, closeFocusedTask } from "../../webview-ui/agent-manager/task-close"

describe("Agent Manager close all tasks", () => {
  it("clears visible tasks in one batch", async () => {
    const events: string[] = []
    const local = ["s1", "pending-1"]
    const closed = new Set<string>()
    const removed: string[] = []
    const posted: string[][] = []

    closeAllTasks({
      tabs: [{ id: "s1" }, { id: "pending-1" }],
      freeze: () => events.push("freeze"),
      pending: (id) => id.startsWith("pending-"),
      local: new Set(local),
      clear: () => events.push("clear"),
      setPending: (id) => events.push(`pending:${id}`),
      forget: (id) => events.push(`forget:${id}`),
      setLocal: (next) => {
        local.splice(0, local.length, ...next(local))
      },
      submitting: () => false,
      sending: () => true,
      discard: (id) => events.push(`discard:${id}`),
      closed,
      remove: (id) => removed.push(id),
      post: (ids) => posted.push(ids),
      restore: () => events.push("restore"),
    })
    await Promise.resolve()

    expect(local).toEqual([])
    expect(closed).toEqual(new Set(["pending-1"]))
    expect(removed).toEqual(["pending-1"])
    expect(posted).toEqual([["s1", "pending-1"]])
    expect(events).toEqual([
      "freeze",
      "clear",
      "pending:undefined",
      "forget:s1",
      "forget:pending-1",
      "discard:pending-1",
      "restore",
    ])
  })

  it("only closes a focused session tab", () => {
    const closed: string[] = []
    const tabs = new Map([["s1", {}]])

    closeFocusedTask("terminal:1", tabs, (id) => closed.push(id))
    closeFocusedTask("s1", tabs, (id) => closed.push(id))

    expect(closed).toEqual(["s1"])
  })
})
