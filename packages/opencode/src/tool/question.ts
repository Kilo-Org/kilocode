import z from "zod"
import { Effect } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import DESCRIPTION from "./question.txt"
import { KiloQuestionTool } from "@/kilocode/tool/question" // kilocode_change

const parameters = z.object({
  questions: z.array(Question.Prompt.zod).describe("Questions to ask"),
})

type Metadata = {
  answers: ReadonlyArray<Question.Answer>
  dismissed?: boolean // kilocode_change
}

export const QuestionTool = Tool.define<typeof parameters, Metadata, Question.Service>(
  "question",
  Effect.gen(function* () {
    const question = yield* Question.Service

    return {
      description: DESCRIPTION,
      parameters,
      execute: (params: z.infer<typeof parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          // kilocode_change start - surface Question.dismissAll's RejectedError as a normal
          // tool result via KiloQuestionTool helpers, so Effect.orDie below does not turn
          // it into a defect and kill the in-flight stream.
          const answers = yield* question
            .ask({
              sessionID: ctx.sessionID,
              questions: params.questions,
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            .pipe(KiloQuestionTool.catchDismissed)
          if (KiloQuestionTool.isDismissed(answers)) return KiloQuestionTool.dismissedResult()
          // kilocode_change end

          const formatted = params.questions
            .map((q, i) => `"${q.question}"="${answers[i]?.length ? answers[i].join(", ") : "Unanswered"}"`)
            .join(", ")

          return {
            title: `Asked ${params.questions.length} question${params.questions.length > 1 ? "s" : ""}`,
            output: `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`,
            metadata: {
              answers,
            },
          }
        }).pipe(Effect.orDie),
    }
  }),
)
