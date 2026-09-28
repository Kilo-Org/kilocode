import { describe, expect, it } from "bun:test"
import { counts, expands, groups } from "../../webview-ui/agent-manager/pr/pr-check-groups"
import type { PRCheck } from "../../webview-ui/agent-manager/pr/pr-types"

const check = (name: string, status: PRCheck["status"]): PRCheck => ({ name, status })

describe("PR check groups", () => {
  it("orders status groups by signal and sorts matrix names naturally", () => {
    const result = groups([
      check("unit (windows, 10/6)", "success"),
      check("unit (windows, 2/6)", "success"),
      check("lint", "pending"),
      check("build", "failure"),
      check("docs", "skipped"),
    ])

    expect(result.map((item) => item.bucket)).toEqual(["failure", "pending", "skipped", "success"])
    expect(result.at(-1)?.checks.map((item) => item.name)).toEqual(["unit (windows, 2/6)", "unit (windows, 10/6)"])
  })

  it("returns counts and opens only actionable groups by default", () => {
    expect(counts([check("build", "failure"), check("lint", "pending"), check("tests", "success")])).toEqual([
      { bucket: "failure", count: 1 },
      { bucket: "pending", count: 1 },
      { bucket: "success", count: 1 },
    ])
    expect(expands("failure")).toBe(true)
    expect(expands("pending")).toBe(true)
    expect(expands("cancelled")).toBe(true)
    expect(expands("skipped")).toBe(false)
    expect(expands("success")).toBe(false)
  })
})
