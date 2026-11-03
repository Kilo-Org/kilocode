import { describe, expect, test } from "bun:test"
import { sessionDiffRange } from "../webview-ui/src/v2/session-diff-range"

describe("sessionDiffRange", () => {
  test("spans from the oldest page to the newest page, past the client cache page", () => {
    const oldest = { data: [{ id: "msg_old" }] }
    const newest = { data: [{ id: "msg_new" }] }

    expect(sessionDiffRange(oldest, newest)).toEqual({ from: "msg_old", to: "msg_new" })
  })

  test("uses the newest turn when the session has one user message", () => {
    const only = { data: [{ id: "msg_only" }] }

    expect(sessionDiffRange(only, only)).toEqual({ from: "msg_only", to: undefined })
  })

  test("has no range without a user message", () => {
    expect(sessionDiffRange({ data: [] }, { data: [] })).toEqual({})
  })
})
