import { describe, expect, it } from "bun:test"
import {
  activities,
  activity,
  isActivity,
  label,
  running,
  score,
  strongest,
  type Activity,
} from "../../webview-ui/src/utils/session-activity"
import { ancestry } from "../../webview-ui/src/context/session-utils"

describe("activity", () => {
  it("maps backend states", () => {
    expect(activity({})).toBe("idle")
    expect(activity({ status: "busy" })).toBe("busy")
    expect(activity({ status: "retry" })).toBe("retry")
    expect(activity({ status: "offline" })).toBe("error")
  })

  it("prioritizes waiting over terminal and running states", () => {
    expect(activity({ status: "busy", blocked: true, errored: true, finished: true })).toBe("waiting")
  })

  it("prioritizes errors over running and completed states", () => {
    expect(activity({ status: "retry", errored: true, finished: true })).toBe("error")
  })

  it("only reports done while idle", () => {
    expect(activity({ status: "busy", finished: true })).toBe("busy")
    expect(activity({ finished: true })).toBe("done")
  })

})

describe("activities", () => {
  const parents = new Map([
    ["child", "root"],
    ["nested", "child"],
  ])

  it("derives nested requests and active work without reading transcript pages", () => {
    const result = activities({
      parents,
      statuses: { root: { type: "idle" }, child: { type: "retry" }, other: { type: "busy" } },
      outcomes: {},
      blocked: ["nested"],
      disconnected: false,
    })
    expect(result).toEqual({ root: "waiting", child: "waiting", nested: "waiting", other: "busy" })
  })

  it("rolls up child work but leaves terminal outcomes with their owning sessions", () => {
    const input = {
      parents,
      statuses: {},
      outcomes: { child: { reason: "error" }, nested: { reason: "completed" } },
      blocked: [],
      disconnected: false,
    }
    expect(activities(input)).toEqual({ child: "error", nested: "done" })
    expect(activities({ ...input, submitting: ["nested"] })).toEqual({
      root: "busy",
      child: "error",
      nested: "busy",
    })
    expect(activities({ ...input, outcomes: { ...input.outcomes, root: { reason: "completed" } } }).root).toBe("done")
  })

  it("hides acknowledged completion without changing other activity", () => {
    const input = {
      parents,
      statuses: {},
      outcomes: { root: { reason: "completed", seen: true }, child: { reason: "error", seen: true } },
      blocked: [],
      disconnected: false,
    }
    expect(activities(input)).toEqual({ root: "idle", child: "error" })
    expect(activities({ ...input, blocked: ["root"] }).root).toBe("waiting")
    expect(input.outcomes.root.reason).toBe("completed")
  })

  it("shows disconnected active sessions as errors without changing idle or completed sessions", () => {
    const input = {
      parents,
      statuses: { root: { type: "busy" as const }, other: { type: "idle" as const } },
      outcomes: { complete: { reason: "completed" } },
      blocked: ["nested"],
      disconnected: true,
    }
    expect(activities(input)).toEqual({
      root: "error",
      child: "error",
      nested: "error",
      other: "idle",
      complete: "done",
    })
    expect(activities({ ...input, disconnected: false }).root).toBe("waiting")
  })

  it("does not leak a parent request into child or sibling session indicators", () => {
    expect(
      activities({
        parents,
        statuses: { child: { type: "busy" }, nested: { type: "idle" } },
        outcomes: {},
        blocked: ["root"],
        disconnected: false,
      }),
    ).toEqual({ root: "waiting", child: "busy", nested: "idle" })
  })

  it("guards cycles and does not mutate its source state", () => {
    const parents = new Map([
      ["first", "second"],
      ["second", "first"],
    ])
    const statuses = { first: { type: "busy" as const } }
    const input = { parents, statuses, outcomes: {}, blocked: [], disconnected: false }
    expect(activities(input)).toEqual({ first: "busy", second: "busy" })
    expect(activities({ ...input, statuses: {} })).toEqual({})
    expect(statuses).toEqual({ first: { type: "busy" } })
  })
})

describe("ancestry", () => {
  it("prefers durable session metadata over task and close-event fallbacks", () => {
    const result = ancestry(
      { child: { parentID: "root" }, root: { parentID: null } },
      {
        other: [
          { type: "tool", tool: "task", metadata: { sessionId: "child" } },
          { type: "tool", tool: "task", state: { metadata: { sessionId: "fallback" } } },
        ],
      },
      { child: { parentID: "stale" }, missing: { parentID: "root" } },
    )
    expect(Object.fromEntries(result.parents)).toEqual({ child: "root", fallback: "other", missing: "root" })
    expect(result.children.get("root")).toEqual(["child", "missing"])
  })
})

describe("isActivity", () => {
})

describe("running", () => {
  it("matches spinner states", () => {
    expect(running("busy")).toBe(true)
    expect(running("retry")).toBe(true)
    expect(running("waiting")).toBe(false)
    expect(running("done")).toBe(false)
  })
})

describe("score", () => {
})

describe("strongest", () => {
})

describe("label", () => {
})
