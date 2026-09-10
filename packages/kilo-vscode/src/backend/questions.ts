import type { FormInfo, OpenCodeClient } from "@opencode-ai/client/promise"
import { Option, Schema } from "effect"
import type { QuestionRequest } from "./view-types"
import { result, type AdapterOptions } from "./result"

const Tool = Schema.Struct({ messageID: Schema.String, id: Schema.String })

/** The native question tool produces string and multiselect form fields. */
export function questionView(form: FormInfo): QuestionRequest {
  const tool = Option.getOrUndefined(Schema.decodeUnknownOption(Tool)(form.metadata?.tool))
  return {
    id: form.id,
    sessionID: form.sessionID,
    blocking: true,
    tool: tool ? { messageID: tool.messageID, callID: tool.id } : undefined,
    questions: form.fields.map((field) => {
      if ((field.type !== "string" && field.type !== "multiselect") || field.when?.length)
        throw new Error("This form requires native field controls that are not ported yet")
      return {
        header: field.title ?? form.title,
        question: field.description ?? field.title ?? form.title,
        options: (field.options ?? []).map((option) => ({
          label: option.label,
          description: option.description ?? "",
        })),
        multiple: field.type === "multiselect",
        custom: field.custom ?? !field.options?.length,
      }
    }),
  }
}

export function createQuestionMethods(client: OpenCodeClient, defaultDirectory: string) {
  async function pending(input: { requestID: string; directory?: string }, signal?: AbortSignal) {
    const response = await client.form.request.list(
      { location: { directory: input.directory ?? defaultDirectory } },
      { signal },
    )
    const form = response.data.find((form) => form.id === input.requestID)
    if (!form) throw new Error("Question request not found in this workspace")
    return form
  }
  return {
    list: <Throw extends boolean = false>(input: { directory?: string } = {}, options?: AdapterOptions<Throw>) =>
      result(async () => {
        const response = await client.form.request.list(
          { location: { directory: input.directory ?? defaultDirectory } },
          options,
        )
        return response.data.map(questionView)
      }, options),
    reply: <Throw extends boolean = false>(
      input: { requestID: string; directory?: string; answers: string[][] },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const form = await pending(input, options?.signal)
        questionView(form)
        if (input.answers.length !== form.fields.length)
          throw new Error("Answer count does not match the pending questions")
        const answer = Object.fromEntries(
          form.fields.flatMap<[string, string | string[]]>((field, index) => {
            const values = input.answers[index].map((label) => {
              if (field.type !== "string" && field.type !== "multiselect") throw new Error("Unsupported question field")
              return field.options?.find((option) => option.label === label)?.value ?? label
            })
            if (field.type === "multiselect") return [[field.key, values]]
            if (values.length > 1) throw new Error("A single-choice question accepts only one answer")
            return values.length ? [[field.key, values[0]]] : []
          }),
        )
        await client.form.reply({ sessionID: form.sessionID, formID: form.id, answer }, options)
      }, options),
    reject: <Throw extends boolean = false>(
      input: { requestID: string; directory?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const form = await pending(input, options?.signal)
        await client.form.cancel({ sessionID: form.sessionID, formID: form.id }, options)
      }, options),
  }
}
