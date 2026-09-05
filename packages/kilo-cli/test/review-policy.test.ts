import { expect, test } from "bun:test"
import { reviewPrompt } from "../src/review-policy"

test("review policy preserves literal guidance without template replacement or execution", () => {
  const guidance = 'staged "quoted" $&\n$(touch never-created)'
  const text = reviewPrompt(guidance)
  expect(text.endsWith(JSON.stringify(guidance))).toBe(true)
  expect(text).toContain("Never eval or interpolate raw input into shell syntax")
  expect(text).toContain("Reject option-like refs")
})

test("review policy retains Kilo scope, evidence and post-review boundaries using v2 tools", () => {
  const text = reviewPrompt("")
  for (const rule of [
    "REVIEW PHASE: DO NOT EDIT",
    "Explicit staged",
    "Explicit unpushed",
    "WORKTREE METADATA",
    "If none exists, stop and request an explicit base",
    "NO_FINDINGS",
    "Quick/--quick/-q",
    "Honor the user's model, cost, concurrency, and delegation limits",
    "APPROVE WITH SUGGESTIONS",
    "Only after the user's explicit post-review choice may you edit",
  ])
    expect(text).toContain(rule)
  expect(text).not.toContain('"mode": "code"')
  expect(text).not.toContain("If none of those exist, fall back to main")
})
