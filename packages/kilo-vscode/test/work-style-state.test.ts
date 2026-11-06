import { describe, expect, test } from "bun:test"
import { resolveWorkStyleOnboarding } from "../webview-ui/src/context/work-style-state"

describe("resolveWorkStyleOnboarding", () => {
  test("shows the picker for an unset work style", () => {
    expect(resolveWorkStyleOnboarding(false, "unset")).toBe(true)
    expect(resolveWorkStyleOnboarding(true, "unset")).toBe(true)
  })

  test("keeps an already visible picker when the state becomes skipped", () => {
    expect(resolveWorkStyleOnboarding(true, "skipped")).toBe(true)
    expect(resolveWorkStyleOnboarding(false, "skipped")).toBe(false)
  })

  test("hides the picker after a style is chosen", () => {
    expect(resolveWorkStyleOnboarding(true, "human-in-the-loop")).toBe(false)
    expect(resolveWorkStyleOnboarding(true, "autonomous")).toBe(false)
  })
})
