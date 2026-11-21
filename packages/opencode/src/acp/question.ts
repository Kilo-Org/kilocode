// kilocode_change - new file
import type {
  AgentSideConnection,
  CreateElicitationResponse,
  ElicitationPropertySchema,
  ElicitationSchema,
} from "@agentclientprotocol/sdk"
import type { Event, KiloClient } from "@kilocode/sdk/v2"
import { Effect } from "effect"
import type { Question } from "@/question"
import type { ACPSession } from "./session"

type QuestionEvent = Extract<Event, { type: "question.asked" }>
type QuestionInfo = Question.Info
type Answers = ReadonlyArray<ReadonlyArray<string>>

type Connection = Partial<Pick<AgentSideConnection, "unstable_createElicitation">>

/**
 * Tracks the client capability reported by `initialize`. The event subscription
 * starts before the client's capabilities are known, so the handler reads this
 * object at ask time instead of at construction.
 */
export type ClientCapabilities = {
  elicitation: boolean
}

const fieldId = (index: number) => `question_${index + 1}`

function optionSchema(options: ReadonlyArray<QuestionInfo["options"][number]>) {
  return options.map((option) => ({
    const: option.label,
    title: option.label,
  }))
}

function property(question: QuestionInfo, index: number): ElicitationPropertySchema {
  const id = fieldId(index)
  const title = question.header.trim()
  const description = question.question.trim()
  if (question.multiple === true && question.options.length > 0) {
    return {
      type: "array",
      title,
      description,
      items: { anyOf: optionSchema(question.options) },
    }
  }
  if (question.options.length > 0) {
    return {
      type: "string",
      title,
      description,
      oneOf: optionSchema(question.options),
    }
  }
  return {
    type: "string",
    title,
    description,
  }
}

/**
 * Maps Kilo's question prompts onto an ACP form elicitation. Clients that
 * support form elicitation (T3 Code, Zed, …) render native choice inputs and
 * answer through the elicitation response instead of steering the turn.
 */
export function toElicitation(questions: ReadonlyArray<QuestionInfo>) {
  const properties: Record<string, ElicitationPropertySchema> = {}
  const ids: string[] = []
  for (const [index, question] of questions.entries()) {
    const id = fieldId(index)
    ids.push(id)
    properties[id] = property(question, index)
  }
  const schema: ElicitationSchema = {
    type: "object",
    properties,
  }
  const message =
    questions.length === 1
      ? questions[0]?.header?.trim() || "Answer the question to continue."
      : `${questions.length} questions need an answer.`
  return { schema, ids, message }
}

export function toAnswers(ids: ReadonlyArray<string>, content: CreateElicitationResponse): Answers {
  if (content.action !== "accept") return []
  const values = content.content ?? {}
  return ids.map((id) => {
    const value = values[id]
    if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string")
    if (typeof value === "string") return value.length > 0 ? [value] : []
    return []
  })
}

export class Handler {
  private readonly queues = new Map<string, Promise<void>>()

  constructor(
    private readonly input: {
      sdk: KiloClient
      connection: Connection
      session: ACPSession.Interface
      capabilities: ClientCapabilities
    },
  ) {}

  handle(event: QuestionEvent) {
    if (!this.input.capabilities.elicitation) return
    const sessionID = event.properties.sessionID
    const previous = this.queues.get(sessionID) ?? Promise.resolve()
    const next = previous
      .then(() => this.process(event))
      .catch(() => {})
      .finally(() => {
        if (this.queues.get(sessionID) === next) this.queues.delete(sessionID)
      })
    this.queues.set(sessionID, next)
  }

  private async process(event: QuestionEvent) {
    const request = event.properties
    const session = await Effect.runPromise(this.input.session.tryGet(request.sessionID))
    const create = this.input.connection.unstable_createElicitation
    if (!session || !create) return this.reject(request.id, session?.cwd)

    const form = toElicitation(request.questions)
    const response = await create
      .call(this.input.connection, {
        mode: "form",
        sessionId: request.sessionID,
        ...(request.tool?.callID ? { toolCallId: request.tool.callID } : {}),
        message: form.message,
        requestedSchema: form.schema,
      })
      .catch(() => undefined)

    if (!response || response.action !== "accept") {
      await this.reject(request.id, session.cwd)
      return
    }

    await this.reply(request.id, toAnswers(form.ids, response), session.cwd)
  }

  private async reply(requestID: string, answers: Answers, directory: string) {
    await this.input.sdk.question
      .reply({ requestID, answers: answers.map((answer) => [...answer]), directory })
      .catch(() => {})
  }

  private async reject(requestID: string, directory?: string) {
    await this.input.sdk.question.reject({ requestID, directory }).catch(() => {})
  }
}

export * as ACPQuestion from "./question"
