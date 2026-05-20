import { describe, expect, test } from "bun:test"
import { sessionInputQueue } from "../../src/cli/cmd/tui/routes/session/session-input-queue"

describe("TUI child session input prompts", () => {
  test("child sessions use their own input queue", () => {
    const queue = sessionInputQueue(
      { id: "child-1", parentID: "parent" },
      [{ id: "parent" }, { id: "child-1" }, { id: "child-2" }],
      {
        parent: ["parent-permission"],
        "child-1": ["child-permission"],
        "child-2": ["sibling-permission"],
      },
    )

    expect(queue).toEqual(["child-permission"])
  })

  test("parent sessions still aggregate child input queues", () => {
    const queue = sessionInputQueue(
      { id: "parent" },
      [{ id: "parent" }, { id: "child-1" }, { id: "child-2" }],
      {
        parent: ["parent-permission"],
        "child-1": ["child-permission"],
        "child-2": ["sibling-permission"],
      },
    )

    expect(queue).toEqual(["parent-permission", "child-permission", "sibling-permission"])
  })
})
