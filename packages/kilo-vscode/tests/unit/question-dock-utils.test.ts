import { describe, it, expect } from "bun:test"
import {
  pickOutcome,
  resolveOptimisticQuestionAgent,
  resolveQuestionMode,
  resolveSelectedQuestionMode,
  toggleAnswer,
  tr,
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

describe("pickOutcome", () => {
  it("keeps a single-question single-select option pick pending until explicit submit", () => {
    expect(pickOutcome({ single: true, multi: false, custom: false })).toEqual({ kind: "stay" })
  })

  it("advances to the next tab on a multi-question single-select option pick", () => {
    expect(pickOutcome({ single: false, multi: false, custom: false })).toEqual({ kind: "advance" })
  })

  it("stays on the current tab for a multi-select pick", () => {
    expect(pickOutcome({ single: true, multi: true, custom: false })).toEqual({ kind: "stay" })
  })

  it("defers submission for a single-select custom-input pick (handleCustomSubmit owns the submit)", () => {
    expect(pickOutcome({ single: true, multi: false, custom: true })).toEqual({ kind: "stay" })
  })

  it("stays on the current tab for a multi-select custom-input pick", () => {
    expect(pickOutcome({ single: false, multi: true, custom: true })).toEqual({ kind: "stay" })
  })
})

describe("tr", () => {
  it("returns the translated value when the key is present", () => {
    const dict: Record<string, string> = { "plan.followup.answer.continue": "Continuer ici" }
    const t = (key: string) => dict[key] ?? key
    expect(tr(t, "plan.followup.answer.continue", "Continue here")).toBe("Continuer ici")
  })

  it("returns the fallback when key is undefined", () => {
    const t = (key: string) => key
    expect(tr(t, undefined, "Continue here")).toBe("Continue here")
  })

  it("returns the fallback when the key is missing from the dict (language.t echoes the key)", () => {
    const t = (key: string) => key
    expect(tr(t, "plan.followup.answer.continue", "Continue here")).toBe("Continue here")
  })

  it("returns an empty string fallback when no key and no label are available", () => {
    const t = (key: string) => key
    expect(tr(t, undefined, "")).toBe("")
  })

  it("returns the translated value even when the fallback is empty", () => {
    const dict: Record<string, string> = { "plan.followup.question": "Prêt à implémenter ?" }
    const t = (key: string) => dict[key] ?? key
    expect(tr(t, "plan.followup.question", "")).toBe("Prêt à implémenter ?")
  })
})
