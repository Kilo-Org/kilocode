import { describe, expect, test } from "bun:test"
import type { QuestionRequest } from "@kilocode/sdk/v2"
import {
  createQuestionBodyState,
  questionConfirm,
  questionReject,
  questionSave,
  questionSelect,
  questionSetSelected,
  questionStoreCustom,
  questionSubmit,
  questionSync,
  questionToggleAction, // kilocode_change
} from "@/cli/cmd/run/question.shared"

function req(input: Partial<QuestionRequest> = {}): QuestionRequest {
  return {
    id: "question-1",
    sessionID: "session-1",
    questions: [
      {
        question: "Mode?",
        header: "Mode",
        options: [{ label: "chunked", description: "Incremental output" }],
        multiple: false,
      },
    ],
    ...input,
  }
}

describe("run question shared", () => {
  test("replies immediately for a single-select question", () => {
    const out = questionSelect(createQuestionBodyState("question-1"), req())

    expect(out.reply).toEqual({
      requestID: "question-1",
      answers: [["chunked"]],
    })
  })

  test("advances multi-question flows and submits from confirm", () => {
    const ask = req({
      questions: [
        {
          question: "Mode?",
          header: "Mode",
          options: [{ label: "chunked", description: "Incremental output" }],
          multiple: false,
        },
        {
          question: "Output?",
          header: "Output",
          options: [
            { label: "yes", description: "Show tool output" },
            { label: "no", description: "Hide tool output" },
          ],
          multiple: false,
        },
      ],
    })

    let state = questionSelect(createQuestionBodyState("question-1"), ask).state
    expect(state.tab).toBe(1)

    state = questionSetSelected(state, 1)
    state = questionSelect(state, ask).state
    expect(questionConfirm(ask, state)).toBe(true)
    expect(questionSubmit(ask, state)).toEqual({
      requestID: "question-1",
      answers: [["chunked"], ["no"]],
    })
  })

  // kilocode_change start - space toggles, enter advances in multi-select
  test("toggles answers for multiple-choice questions", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
        },
      ],
    })

    let state = questionToggleAction(createQuestionBodyState("question-1"), ask).state
    expect(state.answers).toEqual([["bug"]])

    state = questionToggleAction(state, ask).state
    expect(state.answers).toEqual([[]])
  })

  test("enter advances multi-select tab without toggling", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
        },
      ],
    })

    const state = questionSelect(createQuestionBodyState("question-1"), ask).state
    expect(state.answers).toEqual([])
    expect(state.tab).toBe(1)
    expect(questionConfirm(ask, state)).toBe(true)
  })

  test("enter advances multi-question single-select tab on the last question to confirm", () => {
    const ask = req({
      questions: [
        {
          question: "First?",
          header: "First",
          options: [{ label: "a", description: "" }],
          multiple: false,
        },
        {
          question: "Second?",
          header: "Second",
          options: [{ label: "b", description: "" }],
          multiple: false,
        },
      ],
    })

    let state = createQuestionBodyState("question-1")
    state = questionSelect(state, ask).state
    expect(state.tab).toBe(1)

    state = questionSelect(state, ask).state
    expect(questionConfirm(ask, state)).toBe(true)
  })

  test("toggle is a no-op in single-select", () => {
    const ask = req({
      questions: [
        {
          question: "Mode?",
          header: "Mode",
          options: [{ label: "chunked", description: "" }],
          multiple: false,
        },
      ],
    })

    const state = questionToggleAction(createQuestionBodyState("question-1"), ask).state
    expect(state.answers).toEqual([])
  })

  test("enter advances past the custom row in multi-select", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
          custom: true,
        },
      ],
    })

    let state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    state = questionSelect(state, ask).state
    expect(state.editing).toBe(false)
    expect(state.tab).toBe(1)
  })

  test("enter on custom row in single-select opens the editor", () => {
    const ask = req({
      questions: [
        {
          question: "Mode?",
          header: "Mode",
          options: [{ label: "chunked", description: "" }],
          multiple: false,
          custom: true,
        },
      ],
    })

    const state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    const next = questionSelect(state, ask).state
    expect(next.editing).toBe(true)
  })

  test("space on custom row with typed value toggles it", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
          custom: true,
        },
      ],
    })

    let state = createQuestionBodyState("question-1")
    state = questionStoreCustom(state, 0, "custom-tag")
    state = questionSave(state, ask).state
    expect(state.answers[0]).toContain("custom-tag")

    state = questionSetSelected(state, 1)
    state = questionToggleAction(state, ask).state
    expect(state.answers[0]).not.toContain("custom-tag")

    // Toggle it back on
    state = questionToggleAction(state, ask).state
    expect(state.answers[0]).toContain("custom-tag")
  })

  test("space on custom row without typed value opens the editor", () => {
    const ask = req({
      questions: [
        {
          question: "Tags?",
          header: "Tags",
          options: [{ label: "bug", description: "Bug fix" }],
          multiple: true,
          custom: true,
        },
      ],
    })

    const state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    const next = questionToggleAction(state, ask).state
    expect(next.editing).toBe(true)
  })
  // kilocode_change end

  test("stores and submits custom answers", () => {
    let state = questionSetSelected(createQuestionBodyState("question-1"), 1)
    let next = questionSelect(state, req())
    expect(next.state.editing).toBe(true)

    state = questionStoreCustom(next.state, 0, "  custom mode  ")
    next = questionSave(state, req())
    expect(next.reply).toEqual({
      requestID: "question-1",
      answers: [["custom mode"]],
    })
  })

  test("resets state when the request id changes and builds reject payloads", () => {
    const state = questionSetSelected(createQuestionBodyState("question-1"), 1)

    expect(questionSync(state, "question-1")).toBe(state)
    expect(questionSync(state, "question-2")).toEqual(createQuestionBodyState("question-2"))
    expect(questionReject(req())).toEqual({
      requestID: "question-1",
    })
  })
})
