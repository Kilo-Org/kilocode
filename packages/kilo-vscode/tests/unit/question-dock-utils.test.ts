import { describe, it, expect } from "bun:test"
import { toggleAnswer, buildSubtitleText } from "../../webview-ui/src/components/chat/question-dock-utils"

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

describe("buildSubtitleText", () => {
  it("returns empty string for count of 0", () => {
    expect(buildSubtitleText(0, "question", "questions")).toBe("")
  })

  it("uses singular form for count of 1", () => {
    expect(buildSubtitleText(1, "question", "questions")).toBe("1 question")
  })

  it("uses plural form for count of 2", () => {
    expect(buildSubtitleText(2, "question", "questions")).toBe("2 questions")
  })

  it("uses plural form for large counts", () => {
    expect(buildSubtitleText(10, "question", "questions")).toBe("10 questions")
  })

  it("works with i18n-style translation strings", () => {
    expect(buildSubtitleText(1, "ui.common.question.one", "ui.common.question.other")).toBe("1 ui.common.question.one")
    expect(buildSubtitleText(3, "ui.common.question.one", "ui.common.question.other")).toBe(
      "3 ui.common.question.other",
    )
  })
})
