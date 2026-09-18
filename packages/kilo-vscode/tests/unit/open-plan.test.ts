import { describe, expect, it } from "bun:test"
import type { ExtensionMessage, Part } from "../../webview-ui/src/types/messages"
import { createPlanOpener } from "../../webview-ui/src/utils/open-plan"

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

describe("createPlanOpener", () => {
  it("opens only completed open_plan parts from batched updates", async () => {
    const opened: string[] = []
    const opener = createPlanOpener(
      () => "session-1",
      (plan) => opened.push(`${plan.sessionID}:${plan.id}`),
    )
    const message = {
      type: "partsUpdated",
      updates: [
        update(done("part-valid")),
        update({ ...done("part-tool"), tool: "read" }),
        update({ ...done("part-running"), state: { status: "running", input: {} } }),
        update({
          ...done("part-unmarked"),
          state: { ...done("part-unmarked").state, metadata: { plan: ".kilo/plans/plan.md" } },
        }),
        update({ ...done("part-nopath"), state: { ...done("part-nopath").state, metadata: { open: true } } }),
      ],
    } satisfies Extract<ExtensionMessage, { type: "partsUpdated" }>

    opener.accept(message)
    await Promise.resolve()
    expect(opened).toEqual(["session-1:part-valid"])
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
