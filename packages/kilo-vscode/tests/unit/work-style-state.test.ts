import { describe, expect, it } from "bun:test"
import { resolveWorkStyleOnboarding } from "../../webview-ui/src/context/work-style-state"

describe("work style onboarding state", () => {
  it("shows onboarding while the work style is unset", () => {
    expect(resolveWorkStyleOnboarding(false, "unset")).toBe(true)
  })

  it("does not show onboarding when skipped was already persisted", () => {
    expect(resolveWorkStyleOnboarding(false, "skipped")).toBe(false)
  })

  it("hides onboarding after a work style is selected", () => {
    expect(resolveWorkStyleOnboarding(true, "human-in-the-loop")).toBe(false)
    expect(resolveWorkStyleOnboarding(true, "autonomous")).toBe(false)
  })
})
