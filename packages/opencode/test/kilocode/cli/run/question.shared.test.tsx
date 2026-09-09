/** @jsxImportSource @opentui/solid */
import { describe, expect, test } from "bun:test"
import { BoxRenderable } from "@opentui/core"
import { extend, testRender } from "@opentui/solid"
import type { QuestionRequest } from "@kilocode/sdk/v2"
import {
  createQuestionBodyState,
  questionConfirm,
  questionSelect,
  questionSetSelected,
} from "@/cli/cmd/run/question.shared"
import { questionAdvance } from "@/kilocode/cli/cmd/run/question.shared"
import { RunQuestionBody } from "@/cli/cmd/run/footer.question"
import { RUN_THEME_FALLBACK } from "@/cli/cmd/run/theme"

extend({ spinner: BoxRenderable })

function multiRequest(): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Tags?",
        header: "Tags",
        options: [
          { label: "bug", description: "Bug fix" },
          { label: "feature", description: "New feature" },
        ],
        multiple: true,
      },
      {
        question: "Output?",
        header: "Output",
        options: [
          { label: "yes", description: "Show tool output" },
          { label: "no", description: "Hide tool output" },
        ],
      },
    ],
  }
}

describe("run question advance", () => {
  test("advances a multiple-choice question to the next tab", () => {
    const ask = multiRequest()
    let state = questionSelect(createQuestionBodyState("question-1"), ask).state
    expect(state.answers).toEqual([["bug"]])

    state = questionAdvance(state, ask).state
    expect(state.tab).toBe(1)
    expect(state.answers).toEqual([["bug"]])
  })

  test("advances from the last question tab to the confirm tab", () => {
    const ask = multiRequest()
    let state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    state = questionSelect(state, ask).state
    state = questionAdvance(state, ask).state
    state = questionSetSelected(state, 1)
    state = questionSelect(state, ask).state
    expect(questionConfirm(ask, state)).toBe(true)

    state = questionAdvance(state, ask).state
    expect(questionConfirm(ask, state)).toBe(true)
  })

  test("single multiple-choice question advances to the confirm tab", () => {
    const ask = {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
        },
      ],
    } satisfies QuestionRequest

    let state = createQuestionBodyState("question-1")
    state = questionAdvance(state, ask).state
    expect(state.tab).toBe(1)
    expect(questionConfirm(ask, state)).toBe(true)
  })

  test("does not advance single-select questions", () => {
    const ask = {
      id: "question-1",
      sessionID: "session-1",
      questions: [
        {
          question: "Mode?",
          header: "Mode",
          options: [{ label: "chunked", description: "Incremental output" }],
        },
      ],
    } satisfies QuestionRequest

    const state = createQuestionBodyState("question-1")
    expect(questionAdvance(state, ask).state).toBe(state)
  })
})

test("direct question body toggles multiple-choice options with space and advances with enter", async () => {
  const request = {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Which tags apply?",
        header: "Tags",
        options: [
          { label: "bug", description: "Bug fix" },
          { label: "feature", description: "New feature" },
        ],
        multiple: true,
      },
    ],
  } satisfies QuestionRequest
  const replies: unknown[] = []

  const app = await testRender(
    () => (
      <box width={100} height={12}>
        <RunQuestionBody
          request={request}
          theme={RUN_THEME_FALLBACK.footer}
          onReply={(input) => {
            replies.push(input)
          }}
          onReject={() => {}}
        />
      </box>
    ),
    { width: 100, height: 12 },
  )

  try {
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("space")
    expect(app.captureCharFrame()).toContain("toggle")
    expect(app.captureCharFrame()).toContain("next")

    app.mockInput.pressKey(" ")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("[✓] bug")
    expect(replies).toHaveLength(0)

    app.mockInput.pressKey(" ")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("[ ] bug")
    expect(replies).toHaveLength(0)

    app.mockInput.pressArrow("down")
    await app.renderOnce()
    app.mockInput.pressKey(" ")
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("[✓] feature")
    expect(replies).toHaveLength(0)

    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(app.captureCharFrame()).toContain("Review")
    expect(replies).toHaveLength(0)

    app.mockInput.pressEnter()
    await app.renderOnce()
    expect(replies).toEqual([{ requestID: "question-1", answers: [["feature"]] }])
  } finally {
    app.renderer.destroy()
  }
})
