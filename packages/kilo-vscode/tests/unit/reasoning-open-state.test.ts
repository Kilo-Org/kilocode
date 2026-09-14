import { describe, it, expect } from "bun:test"
import { reasoningOpenState, type ReasoningOpenInput } from "../../../kilo-ui/src/components/reasoning-open"

function state(input: Partial<ReasoningOpenInput>): ReasoningOpenInput {
  return {
    capped: false,
    mode: "expanded",
    streamed: false,
    userOpened: false,
    userCollapsed: false,
    ...input,
  }
}

describe("reasoningOpenState", () => {
  it("keeps headline closed by default and open only when the user opened it", () => {
    expect(reasoningOpenState(state({ mode: "headline" }))).toBe(false)
    expect(reasoningOpenState(state({ mode: "headline", userOpened: true }))).toBe(true)
  })

  it("keeps a historical preview closed and opens streamed or user-opened previews", () => {
    expect(reasoningOpenState(state({ mode: "preview" }))).toBe(false)
    expect(reasoningOpenState(state({ mode: "preview", streamed: true }))).toBe(true)
    expect(reasoningOpenState(state({ mode: "preview", userOpened: true }))).toBe(true)
  })

  it("keeps expanded open by default and closed after the user collapses it", () => {
    expect(reasoningOpenState(state({ mode: "expanded" }))).toBe(true)
    expect(reasoningOpenState(state({ mode: "expanded", userCollapsed: true }))).toBe(false)
  })

  it("keeps capped background transcripts open in every mode unless collapsed", () => {
    expect(reasoningOpenState(state({ capped: true, mode: "headline" }))).toBe(true)
    expect(reasoningOpenState(state({ capped: true, mode: "preview" }))).toBe(true)
    expect(reasoningOpenState(state({ capped: true, mode: "expanded" }))).toBe(true)
    expect(reasoningOpenState(state({ capped: true, mode: "preview", userCollapsed: true }))).toBe(false)
  })

  it("lets userCollapsed win over capped and over every mode", () => {
    for (const mode of ["expanded", "preview", "headline"] as const) {
      expect(reasoningOpenState(state({ mode, userCollapsed: true }))).toBe(false)
      expect(reasoningOpenState(state({ capped: true, mode, userCollapsed: true }))).toBe(false)
    }
  })

  it("re-derives a cold mount from the expanded default to headline closed", () => {
    // The part mounts before configLoaded, so the resolved mode starts at the
    // expanded default; the same part state resolves to headline once config
    // arrives and the block must not stay open.
    const part = { capped: false, streamed: false, userOpened: false, userCollapsed: false }
    expect(reasoningOpenState({ ...part, mode: "expanded" })).toBe(true)
    expect(reasoningOpenState({ ...part, mode: "headline" })).toBe(false)
  })
})
