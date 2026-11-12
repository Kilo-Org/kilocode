import { expect, test } from "bun:test"
import { reasoningOpenState, type ReasoningOpenInput } from "../src/components/reasoning-open"

function state(input: Partial<ReasoningOpenInput>): ReasoningOpenInput {
  return { mode: "expanded", userOpened: false, userCollapsed: false, ...input }
}

test("each mode decides its own open state, without depending on whether the block streamed", () => {
  expect(reasoningOpenState(state({ mode: "expanded" }))).toBe(true)
  expect(reasoningOpenState(state({ mode: "preview" }))).toBe(true)
  expect(reasoningOpenState(state({ mode: "headline" }))).toBe(false)
})

test("headline opens only when the user opened it", () => {
  expect(reasoningOpenState(state({ mode: "headline", userOpened: true }))).toBe(true)
  expect(reasoningOpenState(state({ mode: "preview", userOpened: true }))).toBe(true)
})

test("a user collapse wins over every mode", () => {
  for (const mode of ["expanded", "preview", "headline"] as const) {
    expect(reasoningOpenState(state({ mode, userCollapsed: true }))).toBe(false)
  }
})

test("a block mounted before the config loads re-derives from the resolved mode", () => {
  const part = { userOpened: false, userCollapsed: false }
  expect(reasoningOpenState({ ...part, mode: "expanded" })).toBe(true)
  expect(reasoningOpenState({ ...part, mode: "headline" })).toBe(false)
})
