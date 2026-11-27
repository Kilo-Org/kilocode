import type { FormInfo } from "@opencode/client"

/**
 * The composer and the question dock are siblings: the dock owns the active question, its visible
 * tab and the partial answers, so a send from the main prompt is handed to the dock instead of
 * replying to the form here. `undefined` means the dock did not take the text (no dock for the
 * form, the review step, or a field that cannot be typed), and the send continues as a prompt.
 */
export type QuestionAnswer = (text: string) => Promise<boolean | undefined> | boolean | undefined

/** The parts of a composer send that make it a prompt rather than a question answer. */
export type SendParts = {
  items?: ReadonlyArray<unknown>
  files?: ReadonlyArray<unknown>
  metadata?: unknown
}

const handlers = new Map<string, QuestionAnswer>()

/** Registers the answer path of a mounted dock and returns the cleanup that removes it. */
export function registerQuestionAnswer(id: string, answer: QuestionAnswer) {
  handlers.set(id, answer)
  return () => {
    if (handlers.get(id) === answer) handlers.delete(id)
  }
}

export function answerQuestion(form: FormInfo | undefined, text: string, parts?: SendParts) {
  if (!form || form.metadata?.kind !== "question") return undefined
  // Attachments and references belong to a prompt, so they never become a question answer.
  if (parts?.items?.length || parts?.files?.length || parts?.metadata) return undefined
  return handlers.get(form.id)?.(text)
}
