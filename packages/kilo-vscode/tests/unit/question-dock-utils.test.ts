import { describe, it, expect } from "bun:test"
import {
  resolveOptimisticQuestionAgent,
  resolveQuestionMode,
  resolveSelectedQuestionMode,
  toggleAnswer,
} from "../../webview-ui/src/components/chat/question-dock-utils"

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

describe("resolveQuestionMode", () => {
  it("returns mode for matching predefined option", () => {
    const result = resolveQuestionMode(
      [
        { label: "Implement", description: "Switch to code", mode: "code" },
        { label: "Stay", description: "Remain here" },
      ],
      "Implement",
    )

    expect(result).toBe("code")
  })

  it("returns undefined for unknown answer", () => {
    const result = resolveQuestionMode([{ label: "Implement", description: "Switch", mode: "code" }], "Custom")
    expect(result).toBeUndefined()
  })

  it("returns undefined when option has no mode", () => {
    const result = resolveQuestionMode([{ label: "Stay", description: "Remain here" }], "Stay")
    expect(result).toBeUndefined()
  })
})

describe("resolveSelectedQuestionMode", () => {
  it("returns the selected mode from predefined answers", () => {
    const result = resolveSelectedQuestionMode(
      [
        [
          { label: "Implement", description: "Switch to code", mode: "code" },
          { label: "Stay", description: "Remain here" },
        ],
      ].map((options) => ({ options })),
      [["Implement"]],
    )

    expect(result).toBe("code")
  })

  it("ignores custom answers that replace a mode option", () => {
    const result = resolveSelectedQuestionMode(
      [{ options: [{ label: "Implement", description: "Switch to code", mode: "code" }] }],
      [["Implement custom flow"]],
    )

    expect(result).toBeUndefined()
  })

  it("keeps mode answers from other questions", () => {
    const result = resolveSelectedQuestionMode(
      [
        { options: [{ label: "Implement", description: "Switch to code", mode: "code" }] },
        { options: [{ label: "Stay", description: "Remain here" }] },
      ],
      [["Implement"], ["Stay"]],
    )

    expect(result).toBe("code")
  })
})

describe("resolveOptimisticQuestionAgent", () => {
  it("stores the previous agent when applying an optimistic mode", () => {
    const result = resolveOptimisticQuestionAgent(undefined, "ask", "code")

    expect(result).toEqual({ base: "ask", agent: "code" })
  })

  it("reverts to the stored previous agent when the mode is cleared", () => {
    const result = resolveOptimisticQuestionAgent("ask", "code", undefined)

    expect(result).toEqual({ base: undefined, agent: "ask" })
  })

  it("avoids switching when the selected mode already matches the current agent", () => {
    const result = resolveOptimisticQuestionAgent(undefined, "code", "code")

    expect(result).toEqual({ base: undefined, agent: undefined })
  })

  it("keeps the original base agent while changing between mode answers", () => {
    const result = resolveOptimisticQuestionAgent("ask", "code", "architect")

    expect(result).toEqual({ base: "ask", agent: "architect" })
  })
})
