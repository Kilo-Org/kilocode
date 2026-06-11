import { describe, expect, it } from "bun:test"
import { resolveWorkStyleOnboarding } from "../../webview-ui/src/context/work-style-state"

describe("work style onboarding state", () => {
  it("shows unset onboarding and keeps that one-off view visible after persisting skipped", () => {
    const shown = resolveWorkStyleOnboarding(false, "unset")
    expect(shown).toBe(true)
    expect(resolveWorkStyleOnboarding(shown, "skipped")).toBe(true)
  })

  it("does not show onboarding when skipped was already persisted", () => {
    expect(resolveWorkStyleOnboarding(false, "skipped")).toBe(false)
  })

  it("hides onboarding after a work style is selected", () => {
    expect(resolveWorkStyleOnboarding(true, "human")).toBe(false)
    expect(resolveWorkStyleOnboarding(true, "autonomous")).toBe(false)
  })
})
