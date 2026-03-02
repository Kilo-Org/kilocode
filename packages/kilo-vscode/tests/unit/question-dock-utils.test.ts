import { describe, it, expect } from "bun:test"
import { toggleAnswer } from "../../webview-ui/src/components/chat/question-dock-utils"

describe("toggleAnswer", () => {
  it("adds answer when not present", () => {
    expect(toggleAnswer([], "option-a")).toEqual(["option-a"])
  })

  it("removes answer when already present", () => {
    expect(toggleAnswer(["option-a"], "option-a")).toEqual([])
  })

  it("adds to existing answers without removing others", () => {
    const result = toggleAnswer(["a", "b"], "c")
    expect(result).toEqual(["a", "b", "c"])
  })

  it("removes from the middle without affecting other entries", () => {
    const result = toggleAnswer(["a", "b", "c"], "b")
    expect(result).toEqual(["a", "c"])
  })

  it("does not mutate the original array", () => {
    const original = ["a", "b"]
    toggleAnswer(original, "c")
    expect(original).toEqual(["a", "b"])
  })

  it("handles empty answer string", () => {
    expect(toggleAnswer([], "")).toEqual([""])
    expect(toggleAnswer([""], "")).toEqual([])
  })

  it("only removes the first occurrence (deduplication edge case)", () => {
    const result = toggleAnswer(["a", "a"], "a")
    expect(result).toEqual(["a"])
  })
})
