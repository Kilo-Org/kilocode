import { APICallError, type ModelMessage } from "ai"
import { Effect } from "effect"
import { z } from "zod"
import type { Provider } from "@/provider/provider"
import { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { EventV2Bridge } from "@/event-v2-bridge"
import type { SessionID } from "@/session/schema"
import type { LLMEvent } from "@opencode-ai/llm"

export namespace AnthropicRecovery {
  const key = "kilocode.anthropic-replay-exclusion"
  const phrase = "blocks in the latest assistant message cannot be modified"
  const schema = z.object({ error: z.object({ type: z.literal("invalid_request_error") }) })

  export function output(event: LLMEvent) {
    return !["step-start", "step-finish", "finish", "provider-error"].includes(event.type)
  }

  // Follow kilocode/provider/error.ts hint(): adapter/status plus narrowly matched provider text.
  export function matches(error: unknown, model: Provider.Model, output: boolean) {
    if (output || model.api.npm !== "@ai-sdk/anthropic") return false
    if (!APICallError.isInstance(error) || error.statusCode !== 400 || !error.message.includes(phrase)) return false
    if (!error.responseBody) return false
    return Effect.runSync(
      Effect.try({ try: () => JSON.parse(error.responseBody ?? "") as unknown, catch: (error) => error }).pipe(
        Effect.map((body) => schema.safeParse(body).success),
        Effect.catch(() => Effect.succeed(false)),
      ),
    )
  }

  export function latest(messages: ModelMessage[]) {
    const message = messages.findLast((item) => item.role === "assistant")
    if (!message || !Array.isArray(message.content)) return undefined
    const parts = message.content.filter((part) => part.type === "reasoning")
    return parts.length ? parts : undefined
  }

  export function exclude(
    part: SessionV1.ReasoningPart,
    model: Provider.Model,
    error: string,
  ): SessionV1.ReasoningPart {
    return {
      ...part,
      metadata: { ...part.metadata, [key]: { version: 1, providerID: model.providerID, modelID: model.id, error } },
    }
  }

  export function excluded(part: MessageV2.Part, model: Provider.Model) {
    if (part.type !== "reasoning") return false
    const value = part.metadata?.[key]
    return value?.version === 1 && model.api.npm === "@ai-sdk/anthropic"
  }

  function lastStepReasoning(parts: MessageV2.Part[]) {
    const boundary = parts.findLastIndex((part) => part.type === "step-start")
    return parts.slice(boundary + 1).filter((part): part is SessionV1.ReasoningPart => part.type === "reasoning")
  }

  export function record(input: { sessionID: string; messageID: string; parts: string[]; error: string }) {
    return {
      sessionID: input.sessionID,
      messageID: input.messageID,
      parts: input.parts,
      excluded: input.parts.length,
      error: input.error,
    }
  }

  export const repair = Effect.fn("AnthropicRecovery.repair")(function* (input: {
    sessionID: SessionID
    model: Provider.Model
    messages: ModelMessage[]
    error: APICallError
  }) {
    const outbound = latest(input.messages)
    if (!outbound) return undefined
    const session = yield* Session.Service
    const history = yield* session.messages({ sessionID: input.sessionID })
    // Match source content, never the proxy-shifted messages.N path in the error.
    const source = history.findLast((item) => {
      if (
        item.info.role !== "assistant" ||
        item.info.providerID !== input.model.providerID ||
        item.info.modelID !== input.model.id
      )
        return false
      const parts = lastStepReasoning(item.parts)
      return (
        parts.length === outbound.length &&
        parts.every((stored, index) => {
          const part = outbound.at(index)
          return (
            part !== undefined &&
            !excluded(stored, input.model) &&
            stored.text === part.text &&
            stored.metadata?.anthropic?.signature === part.providerOptions?.anthropic?.signature &&
            stored.metadata?.anthropic?.redactedData === part.providerOptions?.anthropic?.redactedData
          )
        })
      )
    })
    if (!source) return undefined
    const parts = lastStepReasoning(source.parts)
    if (!parts.length || parts.some((part) => excluded(part, input.model))) return undefined
    if (
      parts.some(
        (part) => part.metadata?.anthropic?.signature == null && part.metadata?.anthropic?.redactedData == null,
      )
    )
      return undefined
    // One transaction prevents a crash from leaving a partial reasoning exclusion.
    const events = yield* EventV2Bridge.Service
    const record = AnthropicRecovery.record({
      sessionID: input.sessionID,
      messageID: source.info.id,
      parts: parts.map((part) => part.id),
      error: input.error.message,
    })
    yield* events.publishAll(
      parts.map((part) => ({
        definition: SessionV1.Event.PartUpdated,
        data: { sessionID: input.sessionID, part: exclude(part, input.model, input.error.message), time: Date.now() },
      })),
    )
    yield* Effect.logWarning("Anthropic latest thinking excluded from replay; retrying once", record)
    const last = input.messages.findLast((message) => message.role === "assistant")
    const messages: ModelMessage[] = []
    for (const message of input.messages) {
      if (message !== last || message.role !== "assistant" || !Array.isArray(message.content)) {
        messages.push(message)
        continue
      }
      const content = message.content.filter((part) => part.type !== "reasoning")
      if (content.length) messages.push({ ...message, content })
    }
    return messages
  })

  export function recover<A, R, R2>(input: {
    run: () => Effect.Effect<A, unknown, R>
    model: Provider.Model
    output: () => boolean
    repair: (error: APICallError) => Effect.Effect<boolean, unknown, R2>
  }) {
    return input.run().pipe(
      Effect.catch((original) => {
        if (!matches(original, input.model, input.output()) || !APICallError.isInstance(original))
          return Effect.fail(original)
        return input.repair(original).pipe(
          Effect.catch((error) =>
            Effect.logWarning("Anthropic thinking exclusion could not be persisted", {
              error: error instanceof Error ? error.message : "Unknown persistence failure",
              original: original.message,
            }).pipe(Effect.andThen(Effect.fail(original))),
          ),
          Effect.flatMap((repaired) => {
            if (!repaired) return Effect.fail(original)
            return input.run().pipe(
              Effect.catch((error) =>
                Effect.logWarning("Anthropic thinking recovery failed", {
                  error: error instanceof Error ? error.message : "Unknown provider failure",
                  original: original.message,
                }).pipe(Effect.andThen(Effect.fail(error))),
              ),
            )
          }),
        )
      }),
    )
  }
}
