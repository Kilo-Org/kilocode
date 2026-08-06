import { describe, expect, test } from "bun:test"
import { eventLocation, shouldReportDefaultLocationFailure } from "../../src/context/data"

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

describe("shouldReportDefaultLocationFailure", () => {
  test("suppresses lifecycle aborts after disposal", () => {
    expect(shouldReportDefaultLocationFailure(new DOMException("aborted", "AbortError"), true)).toBe(false)
  })

  test("reports aborts while mounted", () => {
    expect(shouldReportDefaultLocationFailure(new DOMException("aborted", "AbortError"), false)).toBe(true)
  })

  test("reports non-abort failures after disposal", () => {
    expect(shouldReportDefaultLocationFailure(new Error("network failed"), true)).toBe(true)
  })
})
