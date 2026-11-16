import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { recordAnswer, startsPlanSession, takesHandoff, trackPlanAnswers } from "../webview-ui/src/v2/plan-handoff"

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

describe("trackPlanAnswers", () => {
  const hints = {
    kilocode: { options: { q0: { "Start new session": { labelKey: "plan.followup.answer.newSession" } } } },
  }
  type Form = { id: string; sessionID: string; metadata?: { [key: string]: unknown } }
  const mount = (sessions: string[]) => {
    const created = new Set<(event: { data: { form: Form } }) => void>()
    const replied = new Set<(event: { data: { id: string; answer: { [key: string]: unknown } } }) => void>()
    const cancelled = new Set<(event: { data: { id: string } }) => void>()
    const listen =
      <T>(set: Set<T>) =>
      (handler: T) => {
        set.add(handler)
        return () => void set.delete(handler)
      }
    const dispose = createRoot((dispose) => {
      trackPlanAnswers({
        directory: "/tracked",
        sessions: () => sessions,
        forms: () => [],
        created: listen(created),
        replied: listen(replied),
        cancelled: listen(cancelled),
      })
      return dispose
    })
    return {
      dispose,
      create: (form: Form) => created.forEach((handler) => handler({ data: { form } })),
      reply: (id: string, answer: { [key: string]: unknown }) =>
        replied.forEach((handler) => handler({ data: { id, answer } })),
      cancel: (id: string) => cancelled.forEach((handler) => handler({ data: { id } })),
    }
  }

  it("records the new-session reply to a plan follow-up of a shown session", () => {
    const test = mount(["ses_plan"])
    test.create({ id: "frm_plan", sessionID: "ses_plan", metadata: hints })
    test.reply("frm_plan", { q0: "Start new session" })
    expect(takesHandoff("/tracked")).toBe(true)
    test.dispose()
  })

  it("ignores another webview's session, other answers and cancelled forms", () => {
    const test = mount(["ses_plan"])
    test.create({ id: "frm_elsewhere", sessionID: "ses_sidebar", metadata: hints })
    test.reply("frm_elsewhere", { q0: "Start new session" })
    test.create({ id: "frm_continue", sessionID: "ses_plan", metadata: hints })
    test.reply("frm_continue", { q0: "Continue here" })
    test.create({ id: "frm_cancel", sessionID: "ses_plan", metadata: hints })
    test.cancel("frm_cancel")
    test.reply("frm_cancel", { q0: "Start new session" })
    expect(takesHandoff("/tracked")).toBe(false)
    test.dispose()
  })

  it("stops listening when its owner is disposed", () => {
    const test = mount(["ses_plan"])
    test.create({ id: "frm_plan", sessionID: "ses_plan", metadata: hints })
    test.dispose()
    test.reply("frm_plan", { q0: "Start new session" })
    expect(takesHandoff("/tracked")).toBe(false)
  })
})
