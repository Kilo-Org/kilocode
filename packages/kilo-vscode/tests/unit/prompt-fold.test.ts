import { describe, expect, it } from "bun:test"
import { FOLD_RESERVE, FOLD_SLOT, fold } from "../../webview-ui/src/components/chat/prompt-fold"

const pinned = 48

describe("fold", () => {
  it("keeps every action when they fit", () => {
    expect(fold({ width: FOLD_RESERVE + pinned + 4 * FOLD_SLOT, pinned, count: 4 })).toBe(4)
  })

  it("folds progressively and reserves a slot for the overflow button", () => {
    const base = FOLD_RESERVE + pinned
    expect(fold({ width: base + 4 * FOLD_SLOT - 1, pinned, count: 4 })).toBe(2)
    expect(fold({ width: base + 3 * FOLD_SLOT, pinned, count: 4 })).toBe(2)
    expect(fold({ width: base + 2 * FOLD_SLOT, pinned, count: 4 })).toBe(1)
    expect(fold({ width: base + FOLD_SLOT, pinned, count: 4 })).toBe(0)
  })

  it("never goes below zero or above the count", () => {
    expect(fold({ width: 100, pinned, count: 4 })).toBe(0)
    expect(fold({ width: 2000, pinned, count: 3 })).toBe(3)
  })

  it("counts wider pinned actions, such as the goal send button", () => {
    const width = FOLD_RESERVE + pinned + 4 * FOLD_SLOT
    expect(fold({ width, pinned: pinned + 60, count: 4 })).toBeLessThan(4)
  })
})
