import { describe, expect, test } from "bun:test"
import { eventLocation, reportDefaultLocationFailure, shouldReportDefaultLocationFailure } from "../../src/context/data"

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

  test("suppresses cross-realm-shaped lifecycle aborts after disposal", () => {
    expect(shouldReportDefaultLocationFailure({ name: "AbortError" }, true)).toBe(false)
  })

  test("reports aborts while mounted", () => {
    expect(shouldReportDefaultLocationFailure(new DOMException("aborted", "AbortError"), false)).toBe(true)
  })

  test("reports non-abort failures after disposal", () => {
    expect(shouldReportDefaultLocationFailure(new Error("network failed"), true)).toBe(true)
  })
})

describe("reportDefaultLocationFailure", () => {
  test("reports a mounted abort immediately even if disposal happens before other refreshes settle", async () => {
    let disposed = false
    const reports: unknown[] = []
    const abort = Promise.reject(new DOMException("aborted", "AbortError"))
    const pending = Promise.withResolvers<void>()

    const first = reportDefaultLocationFailure(
      abort,
      () => disposed,
      (reason) => reports.push(reason),
    )
    await first
    disposed = true
    pending.reject(new DOMException("aborted", "AbortError"))
    await reportDefaultLocationFailure(
      pending.promise,
      () => disposed,
      (reason) => reports.push(reason),
    )

    expect(reports).toHaveLength(1)
    expect(reports[0]).toBeInstanceOf(DOMException)
  })
})
