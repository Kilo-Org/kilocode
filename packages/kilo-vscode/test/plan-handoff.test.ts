import { describe, expect, it } from "bun:test"
import { recordAnswer, startsPlanSession, takesHandoff } from "../webview-ui/src/v2/plan-handoff"

describe("plan handoff", () => {
  it("opens the new session only for the directory whose plan was answered", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/other", 2_000)).toBe(false)
    expect(takesHandoff("/repo", 2_000)).toBe(true)
  })

  it("opens one session per answer", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/repo", 1_500)).toBe(true)
    expect(takesHandoff("/repo", 1_600)).toBe(false)
  })

  it("ignores an answer from long before the handoff", () => {
    recordAnswer("/repo", 1_000)
    expect(takesHandoff("/repo", 1_000 + 60_000)).toBe(false)
  })
})

describe("startsPlanSession", () => {
  // The plan follow-up form as plan-followup.ts asks it: answers are option labels, hints are keyed by label.
  const form = {
    metadata: {
      kind: "question",
      kilocode: {
        options: {
          q0: {
            "Start new session": { labelKey: "plan.followup.answer.newSession" },
            "Continue here": { labelKey: "plan.followup.answer.continue", mode: "code" },
          },
        },
      },
    },
  }

  it("matches the new-session answer of the plan follow-up", () => {
    expect(startsPlanSession(form, { q0: "Start new session" })).toBe(true)
    expect(startsPlanSession(form, { q0: ["Start new session"] })).toBe(true)
  })

  it("ignores the other answers and other questions", () => {
    expect(startsPlanSession(form, { q0: "Continue here" })).toBe(false)
    expect(startsPlanSession(form, { q0: "Something typed" })).toBe(false)
    expect(startsPlanSession({ metadata: { kind: "question" } }, { q0: "Start new session" })).toBe(false)
    expect(startsPlanSession({}, { q0: "Start new session" })).toBe(false)
  })
})
