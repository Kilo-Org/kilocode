import { describe, expect, test } from "bun:test"
import { resolveReasoningDisplay } from "../webview-ui/src/v2/reasoning-display"

describe("resolveReasoningDisplay", () => {
  test("defaults to expanded when no mode is configured", () => {
    expect(resolveReasoningDisplay({}, undefined)).toBe("expanded")
  })

  test("maps the legacy auto_collapse_reasoning boolean", () => {
    expect(resolveReasoningDisplay({ auto_collapse_reasoning: true }, undefined)).toBe("preview")
    expect(resolveReasoningDisplay({ auto_collapse_reasoning: false }, undefined)).toBe("expanded")
  })

  test("returns an explicit mode", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "headline" }, undefined)).toBe("headline")
  })

  test("lets an explicit mode win over the legacy boolean", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "expanded", auto_collapse_reasoning: true }, {})).toBe(
      "expanded",
    )
  })

  test("lets the project value win over the global value", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "preview" }, { reasoning_display: "headline" })).toBe("preview")
    expect(resolveReasoningDisplay({ auto_collapse_reasoning: false }, { auto_collapse_reasoning: true })).toBe(
      "expanded",
    )
  })

  test("ignores an invalid mode", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "collapsed" }, { reasoning_display: "preview" })).toBe(
      "preview",
    )
  })
})
