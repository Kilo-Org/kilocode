export * as KiloQuestionPlugin from "./question"

import { ToolFailure } from "@opencode/ai"
// Core internals with no public surface: the Form and Permission services that the native question tool uses (the
// plugin API has no forms domain), and the native tool's name, model content and dismissal error. The session runner
// recognizes a dismissal only as `QuestionTool.CancelledError`, so the mirror must raise that class.
import { Form } from "@opencode/core/form"
import { Permission } from "@opencode/core/permission"
import { QuestionTool } from "@opencode/core/tool/plugin/question"
import { define } from "@opencode/plugin/effect/plugin"
import { KiloQuestion } from "@opencode/schema/kilocode/question"
import type { Question } from "@opencode/schema/question"
import { Effect, Option, Schema } from "effect"

export const Input = Schema.Struct({
  questions: Schema.Array(KiloQuestion.Prompt).check(Schema.isNonEmpty()).annotate({ description: "Questions to ask" }),
})
export type Input = typeof Input.Type

/**
 * Lets the `question` tool carry the Kilo option hints (`mode`, `labelKey`, `descriptionKey`) to clients. It updates
 * the native tool in place: the input schema accepts the hints, and a call with hints runs a mirror of the native
 * executor (`packages/core/src/tool/plugin/question.ts`) that adds them to the pending form's metadata. A call without
 * hints runs the native executor unchanged. Name, description, options and output stay upstream's.
 */
export const Plugin = define({
  id: "kilocode.question",
  effect: Effect.fn(function* (ctx) {
    const forms = yield* Effect.serviceOption(Form.Service)
    const permission = yield* Effect.serviceOption(Permission.Service)
    if (Option.isNone(forms) || Option.isNone(permission))
      return yield* Effect.die(new Error("Kilo question hints require the location form and permission services"))

    yield* ctx.tool
      .transform((editor) =>
        editor.update(QuestionTool.name, (tool) => {
          const native = tool.execute
          tool.input = Input
          tool.execute = (input: Input, context) => {
            const options = hints(input.questions)
            if (options === undefined) return native(input, context)
            // kilo_port(unattributed:schema/v1:04e56db46d79)
            return permission.value
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.messageID, id: context.id },
              })
              .pipe(
                Effect.mapError((error) => new ToolFailure({ message: "Permission denied: question", error })),
                Effect.andThen(
                  forms.value
                    .ask({
                      sessionID: context.sessionID,
                      title: "Questions",
                      metadata: {
                        kind: "question",
                        tool: { messageID: context.messageID, id: context.id },
                        kilocode: { options },
                      },
                      fields: [
                        toField(input.questions[0], 0),
                        ...input.questions.slice(1).map((question, index) => toField(question, index + 1)),
                      ],
                    })
                    .pipe(Effect.orDie),
                ),
                Effect.flatMap((state) => {
                  // A dismissal travels as a defect so leaf `mapError` blankets never turn it into model-facing
                  // output; a dismissal with a message is ordinary model-facing feedback.
                  if (state.status === "cancelled" && state.message !== undefined)
                    return Effect.fail(new ToolFailure({ message: state.message }))
                  if (state.status === "cancelled") return Effect.die(new QuestionTool.CancelledError())
                  const output = {
                    answers: input.questions.map((_, index): Question.Answer => {
                      const value = state.answer[`q${index}`]
                      if (value === undefined) return []
                      if (Array.isArray(value)) return Array.from(value)
                      return [String(value)]
                    }),
                  }
                  return Effect.succeed({
                    output,
                    content: QuestionTool.toModelContent(input.questions, output.answers),
                    metadata: { answers: output.answers },
                  })
                }),
              )
          }
        }),
      )
      .pipe(Effect.orDie)
  }),
})

/**
 * The form hints of the questions, or `undefined` when no option carries a hint. Answers are labels, so options are
 * keyed by label; when a question repeats a label, the first option with it owns the key.
 */
export function hints(questions: ReadonlyArray<KiloQuestion.Prompt>): KiloQuestion.FormHints | undefined {
  const entries = questions.flatMap((question, index) => {
    const options = question.options.flatMap((option, position, all) => {
      if (all.findIndex((item) => item.label === option.label) !== position) return []
      const hint = {
        ...(option.mode === undefined ? {} : { mode: option.mode }),
        ...(option.labelKey === undefined ? {} : { labelKey: option.labelKey }),
        ...(option.descriptionKey === undefined ? {} : { descriptionKey: option.descriptionKey }),
      }
      return Object.keys(hint).length === 0 ? [] : [[option.label, hint] as const]
    })
    return options.length === 0 ? [] : [[`q${index}`, Object.fromEntries(options)] as const]
  })
  return entries.length === 0 ? undefined : Object.fromEntries(entries)
}

function toField(question: KiloQuestion.Prompt, index: number): Form.Field {
  return {
    key: `q${index}`,
    title: question.header,
    description: question.question,
    type: question.multiple === true ? "multiselect" : "string",
    options: question.options.map((option) => ({
      value: option.label,
      label: option.label,
      description: option.description,
    })),
    custom: true,
  }
}
