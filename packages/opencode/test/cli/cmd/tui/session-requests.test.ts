// kilocode_change - new file
import { describe, expect, test } from "bun:test"
import { requestsForSession } from "@/cli/cmd/tui/routes/session/requests"

describe("session request visibility", () => {
  test("shows child requests while viewing the child session", () => {
    const result = requestsForSession({ id: "child", parentID: "parent" }, [{ id: "child" }], {
      child: [{ sessionID: "child", id: "request" }],
    })

    expect(result.map((item) => item.id)).toEqual(["request"])
  })

  test("shows all child requests while viewing the parent session", () => {
    const result = requestsForSession(
      { id: "parent" },
      [{ id: "parent" }, { id: "child-a" }, { id: "child-b" }],
      {
        parent: [{ sessionID: "parent", id: "parent-request" }],
        "child-a": [{ sessionID: "child-a", id: "child-request" }],
      },
    )

    expect(result.map((item) => item.id)).toEqual(["parent-request", "child-request"])
  })
})
