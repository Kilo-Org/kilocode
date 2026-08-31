import type { QuestionRequest } from "@kilocode/sdk/v2"
import {
  questionSetTab,
  questionSingle,
  type QuestionBodyState,
  type QuestionStep,
} from "@/cli/cmd/run/question.shared"

// Enter advances a multiple-choice question to the next tab. Lives in the Kilo
// mirror tree so the shared upstream state machine stays untouched; Space
// toggles an option (handled in footer.question.tsx).
export function questionAdvance(state: QuestionBodyState, request: QuestionRequest): QuestionStep {
  if (questionSingle(request) || state.tab >= request.questions.length) {
    return { state }
  }

  return {
    state: questionSetTab(state, state.tab + 1),
  }
}
