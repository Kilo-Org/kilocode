import { describe, expect, it } from "bun:test"
import type { ExtensionMessage, Part } from "../../webview-ui/src/types/messages"
import { createPlanOpener, planOpens } from "../../webview-ui/src/utils/open-plan"

const done = (id = "part-1") =>
  ({
    type: "tool",
    id,
    tool: "open_plan",
    state: {
      status: "completed",
      input: {},
      output: "Opened plan",
      title: "Opening plan",
      metadata: { plan: ".kilo/plans/plan.md", open: true },
    },
  }) satisfies Part

const update = (part: Part, sessionID = "session-1") =>
  ({
    type: "partUpdated",
    sessionID,
    messageID: "message-1",
    part,
  }) satisfies Extract<ExtensionMessage, { type: "partUpdated" }>

describe("planOpens", () => {
  it("returns completed open_plan requests", () => {
    expect(planOpens(update(done()), "session-1")).toEqual([
      { id: "part-1", path: ".kilo/plans/plan.md", sessionID: "session-1" },
    ])
  })

  it("handles batched updates and ignores unrelated parts", () => {
    const message = {
      type: "partsUpdated",
      updates: [
        update(done("part-1")),
        update({ ...done("part-2"), tool: "read" }),
        update({ ...done("part-3"), state: { ...done("part-3").state, metadata: { open: false } } }),
      ],
    } satisfies Extract<ExtensionMessage, { type: "partsUpdated" }>

    expect(planOpens(message, "session-1")).toEqual([
      { id: "part-1", path: ".kilo/plans/plan.md", sessionID: "session-1" },
    ])
  })

  it("ignores plans from sessions that are not active", () => {
    expect(planOpens(update(done()), "session-2")).toEqual([])
    expect(planOpens(update(done()), undefined)).toEqual([])
  })

  it("does not open incomplete or unmarked plan parts", () => {
    const running = {
      ...done("part-running"),
      state: { status: "running", input: {} },
    } satisfies Part
    const unmarked = {
      ...done("part-unmarked"),
      state: { ...done("part-unmarked").state, metadata: { plan: ".kilo/plans/plan.md" } },
    } satisfies Part

    expect(planOpens(update(running), "session-1")).toEqual([])
    expect(planOpens(update(unmarked), "session-1")).toEqual([])
  })

  it("defers inactive plans and replays them when the session becomes active", async () => {
    let active = "session-2"
    const opened: string[] = []
    const opener = createPlanOpener(
      () => active,
      (plan) => opened.push(`${plan.sessionID}:${plan.id}`),
    )
    const plan = update(done("part-deferred"), "session-1")

    opener.accept(plan)
    expect(opened).toEqual([])

    active = "session-1"
    opener.flush(active)
    await Promise.resolve()
    expect(opened).toEqual(["session-1:part-deferred"])
  })

  it("requeues a plan if the active session changes before dispatch", async () => {
    let active = "session-1"
    const opened: string[] = []
    const opener = createPlanOpener(
      () => active,
      (plan) => opened.push(`${plan.sessionID}:${plan.id}`),
    )
    const plan = update(done("part-race"), "session-1")

    opener.accept(plan)
    active = "session-2"
    await Promise.resolve()
    expect(opened).toEqual([])

    active = "session-1"
    opener.flush(active)
    await Promise.resolve()
    expect(opened).toEqual(["session-1:part-race"])
  })
})
