import { describe, expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { QuestionRequest } from "@kilocode/sdk/v2"
import { RunQuestionBody } from "@/cli/cmd/run/footer.question"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"
import {
  createQuestionBodyState,
  questionConfirm,
  questionSelect,
  questionSetSelected,
  questionSetTab,
  questionSubmit,
  questionSync,
} from "@/cli/cmd/run/question.shared"

const question = {
  question: "Mode?",
  header: "Mode",
  options: [
    { label: "chunked", description: "Incremental output" },
    { label: "direct", description: "Direct output" },
  ],
  default: "direct",
}
const request = {
  id: "question-1",
  sessionID: "session-1",
  questions: [question],
} satisfies QuestionRequest

describe("question defaults", () => {
  test.each([
    ["direct", false, 1, "direct"],
    ["unknown", false, 0, "chunked"],
    ["direct", true, 0, "chunked"],
  ] as const)("initializes default %s with multiple=%s", (value, multiple, selected, label) => {
    const info = { ...question, default: value, multiple }
    const ask = { ...request, questions: [info] }
    const state = createQuestionBodyState(ask.id, info)
    expect(state.selected).toBe(selected)
    const out = questionSelect(state, ask)
    expect(out.state.answers).toEqual([[label]])
    if (multiple) {
      expect(out.reply).toBeUndefined()
      expect(questionSelect(out.state, ask).state.answers).toEqual([[]])
      return
    }
    expect(out.reply).toEqual({ requestID: ask.id, answers: [[label]] })
  })

  test("uses defaults on tab changes and resets without replacing user navigation", () => {
    const ask = { ...request, questions: [question, question] }
    const state = createQuestionBodyState(ask.id, question)
    const next = questionSelect(state, ask).state
    expect(next.tab).toBe(1)
    expect(next.selected).toBe(1)
    expect(questionSetTab(next, 0, question).selected).toBe(1)
    const confirm = questionSelect(next, ask).state
    expect(questionConfirm(ask, confirm)).toBe(true)
    expect(confirm.selected).toBe(0)
    expect(questionSubmit(ask, confirm).answers).toEqual([["direct"], ["direct"]])

    const moved = questionSetSelected(state, 0)
    expect(questionSync(moved, ask.id, question)).toBe(moved)
    expect(questionSelect(moved, ask).state.answers).toEqual([["chunked"]])
    const reset = questionSync(moved, "question-2", question)
    expect(reset.selected).toBe(1)
    expect(reset.answers).toEqual([])
  })

  test("direct question body reveals off-screen defaults and follows navigation and resets", async () => {
    const [ask, setAsk] = createSignal({
      ...request,
      questions: [
        {
          ...question,
          options: Array.from({ length: 9 }, (_, index) => ({
            label: `Option ${index + 1}`,
            description: `Description ${index + 1}`,
          })),
          default: "Option 9",
          custom: false,
        },
      ],
    })
    const replies: unknown[] = []
    const app = await testRender(
      () => (
        <RunQuestionBody
          request={ask()}
          theme={RUN_THEME_FALLBACK.footer}
          onReply={(input) => {
            replies.push(input)
          }}
          onReject={() => {}}
        />
      ),
      { width: 100, height: 16 },
    )

    try {
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Option 9")
      expect(app.captureCharFrame()).toContain("Description 9")
      expect(replies).toEqual([])

      app.mockInput.pressKey("j")
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Option 1")
      app.mockInput.pressEnter()
      await app.renderOnce()
      expect(replies).toEqual([{ requestID: request.id, answers: [["Option 1"]] }])

      setAsk({ ...ask(), id: "question-2" })
      await app.renderOnce()
      await app.renderOnce()
      expect(app.captureCharFrame()).toContain("Option 9")
      app.mockInput.pressEnter()
      await app.renderOnce()
      expect(replies.at(-1)).toEqual({ requestID: "question-2", answers: [["Option 9"]] })
    } finally {
      app.renderer.destroy()
    }
  })

  test("direct question body accepts the default on Enter", async () => {
    const replies: unknown[] = []
    const app = await testRender(
      () => (
        <RunQuestionBody
          request={request}
          theme={RUN_THEME_FALLBACK.footer}
          onReply={(input) => {
            replies.push(input)
          }}
          onReject={() => {}}
        />
      ),
      { width: 100, height: 12 },
    )

    try {
      expect(replies).toEqual([])
      app.mockInput.pressEnter()
      await app.renderOnce()
      expect(replies).toEqual([{ requestID: request.id, answers: [["direct"]] }])
      expect(app.captureCharFrame()).toContain("direct ✓")
    } finally {
      app.renderer.destroy()
    }
  })
})
