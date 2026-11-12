import { describe, expect, test } from "bun:test"
import { createPlanOpener } from "../webview-ui/src/v2/open-plan"

const opener = (active: () => string | undefined) => {
  const opened: string[] = []
  const value = createPlanOpener(active, (plan) => opened.push(`${plan.sessionID}:${plan.id}:${plan.path}`))
  return { opened, value }
}

describe("createPlanOpener", () => {
  test("opens a completed open_plan call from its metadata", async () => {
    const { opened, value } = opener(() => "session-1")
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { path: ".kilo2/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-1:.kilo2/plans/dark-mode.md"])
  })

  test("still opens a plan from the earlier metadata key", async () => {
    const { opened, value } = opener(() => "session-1")
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { plan: ".kilo2/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-1:.kilo2/plans/dark-mode.md"])
  })

  test("opens a plan opened by a nested Code Mode call from the execute metadata", async () => {
    const { opened, value } = opener(() => "session-1")
    value.started("session-1", "tool-execute", "execute")
    value.completed("session-1", "tool-execute", { path: ".kilo2/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-execute:.kilo2/plans/dark-mode.md"])
  })

  test("ignores other tools, unmarked results and calls without a path", async () => {
    const { opened, value } = opener(() => "session-1")
    value.started("session-1", "tool-read", "read")
    value.completed("session-1", "tool-read", { path: ".kilo2/plans/dark-mode.md", open: true })
    value.started("session-1", "tool-unmarked", "open_plan")
    value.completed("session-1", "tool-unmarked", { path: ".kilo2/plans/dark-mode.md" })
    value.started("session-1", "tool-nopath", "open_plan")
    value.completed("session-1", "tool-nopath", { open: true })
    value.started("session-1", "tool-failed", "open_plan")
    value.failed("session-1", "tool-failed")
    value.completed("session-1", "tool-failed", { path: ".kilo2/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual([])
  })

  test("opens each tool call once", async () => {
    const { opened, value } = opener(() => "session-1")
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { path: ".kilo2/plans/dark-mode.md", open: true })
    value.completed("session-1", "tool-1", { path: ".kilo2/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-1:.kilo2/plans/dark-mode.md"])
  })

  test("defers an inactive session and opens it when that session becomes active", async () => {
    let active = "session-2"
    const { opened, value } = opener(() => active)
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { path: "/tmp/plans/dark-mode.md", open: true })
    await Promise.resolve()
    expect(opened).toEqual([])

    active = "session-1"
    value.flush(active)
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-1:/tmp/plans/dark-mode.md"])
  })

  test("requeues a plan when the active session changes before dispatch", async () => {
    let active = "session-1"
    const { opened, value } = opener(() => active)
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { path: ".kilo2/plans/dark-mode.md", open: true })
    active = "session-2"
    await Promise.resolve()
    expect(opened).toEqual([])

    active = "session-1"
    value.flush(active)
    await Promise.resolve()
    expect(opened).toEqual(["session-1:tool-1:.kilo2/plans/dark-mode.md"])
  })

  test("forgets a deleted session, so its deferred plan never opens", async () => {
    let active = "session-2"
    const { opened, value } = opener(() => active)
    value.started("session-1", "tool-1", "open_plan")
    value.completed("session-1", "tool-1", { path: ".kilo2/plans/dark-mode.md", open: true })
    value.forget("session-1")
    active = "session-1"
    value.flush(active)
    await Promise.resolve()
    expect(opened).toEqual([])
  })
})
