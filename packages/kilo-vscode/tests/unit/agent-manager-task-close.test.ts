import { describe, expect, it } from "bun:test"
import { activeTask, closeAllTasks, closeFocusedTask } from "../../webview-ui/agent-manager/task-close"

const tasks = (...ids: string[]) => new Map(ids.map((id) => [id, {}]))
const list = (...ids: string[]) => ids.map((id) => ({ id }))

describe("Agent Manager active task", () => {
  it("prefers the open session over a pending draft", () => {
    expect(activeTask(list("s1", "draft"), "s1", "draft")).toBe("s1")
  })

  it("falls back to the pending draft when no session is selected", () => {
    expect(activeTask(list("draft"), undefined, "draft")).toBe("draft")
  })

  // A session can be selected while its tab lives under another worktree, and
  // closing a tab that is not on screen would surprise the user.
  it("ignores a selection that has no open tab", () => {
    expect(activeTask(list("s2"), "s1", undefined)).toBeUndefined()
    expect(activeTask(list(), undefined, undefined)).toBeUndefined()
  })
})

describe("Agent Manager close task", () => {
  it("closes the focused task tab", () => {
    const closed: string[] = []

    closeFocusedTask("s1", tasks("s1", "s2"), (id) => closed.push(id))

    expect(closed).toEqual(["s1"])
  })

  // Terminal, review, and subagent tabs share the tab bar but are not tasks,
  // and `Close Tab` already handles them.
  it("ignores a focused tab that is not a task", () => {
    const closed: string[] = []

    closeFocusedTask("terminal:1", tasks("s1"), (id) => closed.push(id))
    closeFocusedTask(undefined, tasks("s1"), (id) => closed.push(id))

    expect(closed).toEqual([])
  })
})

describe("Agent Manager close all tasks", () => {
  // Closing the active tab selects a neighbour, so the active tab goes last:
  // otherwise selection lands on tabs that are themselves about to close.
  it("closes every task and leaves the active one for last", () => {
    const closed: string[] = []

    closeAllTasks(list("s1", "s2", "s3"), "s2", (id) => closed.push(id))

    expect(closed).toEqual(["s1", "s3", "s2"])
  })

  it("closes every task when none is active", () => {
    const closed: string[] = []

    closeAllTasks(list("s1", "s2"), undefined, (id) => closed.push(id))

    expect(closed).toEqual(["s1", "s2"])
  })

  it("ignores an active id that is not an open task", () => {
    const closed: string[] = []

    closeAllTasks(list("s1"), "gone", (id) => closed.push(id))

    expect(closed).toEqual(["s1"])
  })

  it("does nothing when no tasks are open", () => {
    const closed: string[] = []

    closeAllTasks(list(), undefined, (id) => closed.push(id))

    expect(closed).toEqual([])
  })
})
