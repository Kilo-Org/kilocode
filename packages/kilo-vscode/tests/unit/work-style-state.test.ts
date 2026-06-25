import { describe, expect, it } from "bun:test"
import { advance, initial, update } from "../../webview-ui/src/context/work-style-state"

describe("work style onboarding state", () => {
  it("shows the work-style page and captures Data availability", () => {
    const state = update(initial(), {
      type: "loaded",
      style: "unset",
      available: true,
    })

    expect(state).toEqual({ visible: true, page: "style", available: true })
  })

  it("advances to agent selection when Data is available", () => {
    const shown = update(initial(), {
      type: "loaded",
      style: "unset",
      available: true,
    })
    const next = advance(shown, "autonomous")

    expect(next).toEqual({
      state: { visible: true, page: "agent", available: true, style: "autonomous" },
    })
  })

  it("selects Code without advancing when Data is unavailable", () => {
    const shown = update(initial(), {
      type: "loaded",
      style: "unset",
      available: false,
    })
    const next = advance(shown, "human-in-the-loop")

    expect(next).toEqual({
      state: {
        visible: true,
        page: "style",
        available: false,
        style: "human-in-the-loop",
      },
      agent: "code",
    })
  })

  it("keeps fallback selections on the style page", () => {
    const state = {
      visible: true,
      page: "style" as const,
      available: false,
      style: "human-in-the-loop" as const,
    }

    expect(advance(state, "autonomous").state.page).toBe("style")
    expect(advance(state, "autonomous").agent).toBe("code")
  })

  it("ignores duplicate loaded events while onboarding is visible", () => {
    const state = {
      visible: true,
      page: "agent" as const,
      available: true,
      style: "human-in-the-loop" as const,
    }

    expect(
      update(state, {
        type: "loaded",
        style: "unset",
        available: false,
      }),
    ).toBe(state)
  })

  it("resets state after completion", () => {
    const state = {
      visible: true,
      page: "agent" as const,
      available: true,
      style: "autonomous" as const,
    }

    expect(update(state, { type: "completed" })).toEqual(initial())
  })

  it("resets either page when onboarding is skipped", () => {
    for (const page of ["style", "agent"] as const) {
      const state = {
        visible: true,
        page,
        available: true,
        style: "autonomous" as const,
      }

      expect(update(state, { type: "skipped" })).toEqual(initial())
    }
  })

  it("resets the fallback page when onboarding is skipped", () => {
    const state = {
      visible: true,
      page: "style" as const,
      available: false,
      style: "autonomous" as const,
    }

    expect(update(state, { type: "skipped" })).toEqual(initial())
  })

  it("keeps onboarding hidden when skipped was already persisted", () => {
    const state = update(initial(), {
      type: "loaded",
      style: "skipped",
      available: false,
    })

    expect(state.visible).toBe(false)
  })
})
