import { describe, expect, it } from "bun:test"
import type { ExtensionMessage, Part } from "../../webview-ui/src/types/messages"
import { planOpens } from "../../webview-ui/src/utils/open-plan"

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
    expect(planOpens(update(done()))).toEqual([{ id: "part-1", path: ".kilo/plans/plan.md", sessionID: "session-1" }])
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

    expect(planOpens(message)).toEqual([{ id: "part-1", path: ".kilo/plans/plan.md", sessionID: "session-1" }])
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

    expect(planOpens(update(running))).toEqual([])
    expect(planOpens(update(unmarked))).toEqual([])
  })
})
