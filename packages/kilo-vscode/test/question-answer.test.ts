import { describe, expect, test } from "bun:test"
import type { FormInfo } from "@opencode/client"
import { answerQuestion, registerQuestionAnswer } from "../webview-ui/src/v2/question-answer"

const form = (metadata: FormInfo["metadata"]): FormInfo =>
  ({
    id: "frm_answer",
    sessionID: "ses_1",
    title: "Questions",
    metadata,
    fields: [{ key: "q0", type: "string" }],
  }) as unknown as FormInfo

describe("question answer routing", () => {
  test("hands plain composer text to the dock that owns the question", async () => {
    const seen: string[] = []
    const remove = registerQuestionAnswer("frm_answer", (text) => {
      seen.push(text)
      return true
    })
    expect(await answerQuestion(form({ kind: "question" }), "typed answer")).toBe(true)
    expect(seen).toEqual(["typed answer"])
    remove()
    expect(await answerQuestion(form({ kind: "question" }), "after cleanup")).toBeUndefined()
  })

  test("keeps attachments, references and non-question forms on the prompt path", async () => {
    const seen: string[] = []
    const remove = registerQuestionAnswer("frm_answer", (text) => {
      seen.push(text)
      return true
    })
    const question = form({ kind: "question" })
    expect(await answerQuestion(question, "with files", { files: [{}] })).toBeUndefined()
    expect(await answerQuestion(question, "with items", { items: [{}] })).toBeUndefined()
    expect(await answerQuestion(question, "with metadata", { metadata: {} })).toBeUndefined()
    expect(await answerQuestion(form({ kind: "elicitation" }), "not a question")).toBeUndefined()
    expect(await answerQuestion(undefined, "no form")).toBeUndefined()
    expect(seen).toEqual([])
    remove()
  })

  test("does not remove another dock’s handler for the same id", async () => {
    const seen: string[] = []
    const first = registerQuestionAnswer("frm_answer", () => {
      seen.push("first")
      return true
    })
    const second = registerQuestionAnswer("frm_answer", () => {
      seen.push("second")
      return true
    })
    first()
    expect(await answerQuestion(form({ kind: "question" }), "text")).toBe(true)
    expect(seen).toEqual(["second"])
    second()
    expect(await answerQuestion(form({ kind: "question" }), "text")).toBeUndefined()
  })
})
