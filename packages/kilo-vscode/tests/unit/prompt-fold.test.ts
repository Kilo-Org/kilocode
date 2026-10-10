import { describe, expect, it } from "bun:test"
import { fold } from "../../webview-ui/src/components/chat/prompt-fold"

const base = { pinned: 48, reserve: 210, slot: 26 }
const edge = base.reserve + base.pinned

describe("fold", () => {
  it("keeps every action when they fit", () => {
    expect(fold({ ...base, width: edge + 4 * base.slot, count: 4 })).toBe(4)
  })

  it("folds progressively and reserves a slot for the overflow button", () => {
    expect(fold({ ...base, width: edge + 4 * base.slot - 1, count: 4 })).toBe(2)
    expect(fold({ ...base, width: edge + 3 * base.slot, count: 4 })).toBe(2)
    expect(fold({ ...base, width: edge + 2 * base.slot, count: 4 })).toBe(1)
    expect(fold({ ...base, width: edge + base.slot, count: 4 })).toBe(0)
  })

  it("never goes below zero or above the count", () => {
    expect(fold({ ...base, width: 100, count: 4 })).toBe(0)
    expect(fold({ ...base, width: 2000, count: 3 })).toBe(3)
  })

  it("counts wider pinned actions, such as the goal send button", () => {
    expect(fold({ ...base, width: edge + 4 * base.slot, pinned: base.pinned + 60, count: 4 })).toBeLessThan(4)
  })

  it("scales with a larger font", () => {
    const big = { pinned: 64, reserve: 280, slot: 34 }
    expect(fold({ ...big, width: big.reserve + big.pinned + 4 * big.slot, count: 4 })).toBe(4)
    expect(fold({ ...big, width: big.reserve + big.pinned + 4 * big.slot - 1, count: 4 })).toBe(2)
  })
})
