import { describe, expect, test } from "bun:test"
import { eventLocation } from "../../src/context/data"

describe("eventLocation", () => {
  test("uses the default location for global events", () => {
    expect(eventLocation({ directory: "global" })).toBeUndefined()
  })

  test("preserves project event locations", () => {
    expect(eventLocation({ directory: "/repo", workspace: "wsp_test" })).toEqual({
      directory: "/repo",
      workspaceID: "wsp_test",
    })
  })
})
