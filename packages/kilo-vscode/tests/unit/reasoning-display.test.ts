import { describe, it, expect } from "bun:test"
import { resolveReasoningDisplay } from "../../webview-ui/src/utils/reasoning-display"

describe("resolveReasoningDisplay", () => {
  it("defaults to expanded when no mode is configured", () => {
    expect(resolveReasoningDisplay({})).toBe("expanded")
  })

  it("maps legacy auto_collapse_reasoning true to preview", () => {
    expect(resolveReasoningDisplay({ auto_collapse_reasoning: true })).toBe("preview")
  })

  it("maps legacy auto_collapse_reasoning false to expanded", () => {
    expect(resolveReasoningDisplay({ auto_collapse_reasoning: false })).toBe("expanded")
  })

  it("returns an explicit headline mode", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "headline" })).toBe("headline")
  })

  it("lets explicit expanded override legacy auto_collapse_reasoning true", () => {
    expect(resolveReasoningDisplay({ reasoning_display: "expanded", auto_collapse_reasoning: true })).toBe("expanded")
  })
})
