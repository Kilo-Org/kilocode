export * as MemoryPortsV2 from "./ports"

import { MemoryConfig } from "@kilocode/kilo-memory/effect/config"
import { MemoryError } from "@kilocode/kilo-memory/effect/errors"
import type { MemoryPorts } from "@kilocode/kilo-memory/effect/ports"
import { MemoryMarkerMeta } from "@kilocode/kilo-memory/marker-meta"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"
import { MemoryShared } from "@kilocode/kilo-memory/shared"
import type { Session } from "@opencode/core/session"
import { Model } from "@opencode/schema/model"
import { SessionID } from "@opencode/schema/session-id"
import type { SessionMessage } from "@opencode/schema/session-message"
import { Effect, Schema } from "effect"

type Message = SessionMessage.Info
type User = Extract<Message, { type: "user" }>
type Assistant = Extract<Message, { type: "assistant" }>
type ToolPart = Extract<Assistant["content"][number], { type: "tool" }>

const decodeModel = Schema.decodeUnknownOption(Model.Ref)

// The session port: the latest turn of a v2 session as the package's TurnView.
export function session(sessions: Session.Interface): MemoryPorts.SessionPort {
  return {
    readTurn: ({ sessionID, window }) =>
      Effect.gen(function* () {
        const id = SessionID.make(sessionID)
        const messages = (yield* sessions.messages({ sessionID: id, limit: window, order: "desc" })).toReversed()
        const turn = latest(messages)
        if (!turn) return undefined
        const diffs = yield* sessions.diff({ sessionID: id, from: turn.user.id }).pipe(
          Effect.map((items) =>
            items.map((item) => ({
              file: item.file,
              status: item.status,
              additions: item.additions,
              deletions: item.deletions,
            })),
          ),
          Effect.catchCause(() => Effect.succeed([])),
        )
        const last = turn.assistants[turn.assistants.length - 1]!
        return {
          user: MemoryRedact.text(turn.user.text.trim()),
          assistant: turn.assistants.map(output).filter(Boolean).join("\n"),
          recent: trace(messages, 8),
          lastAssistantID: last.id,
          sessionModel: { providerID: last.model.providerID, modelID: last.model.id },
          recalledMemory: recalled(turn.assistants),
          diffs,
        }
      }).pipe(Effect.mapError(MemoryError.from)),
    get: ({ sessionID }) =>
      sessions.get(SessionID.make(sessionID)).pipe(
        Effect.map((info) => (info.parentID ? { parentID: info.parentID } : {})),
        Effect.mapError(MemoryError.from),
      ),
  }
}

export interface ModelRuntime {
  readonly exists: (ref: Model.Ref) => Effect.Effect<boolean>
  readonly text: (input: { prompt: string; model: Model.Ref }) => Effect.Effect<string, unknown>
  readonly warn: (message: string, meta: Record<string, unknown>) => void
}

// The model port: the configured `memory_model`, else the session model, run through
// stateless generation. The system prompt leads the prompt because generation takes a single prompt.
export function model(runtime: ModelRuntime): MemoryPorts.ModelPort {
  return {
    resolve: ({ configured, session }) =>
      Effect.gen(function* () {
        const fallback = Model.Ref.make({ providerID: session.providerID as never, id: session.modelID as never })
        if (!configured) return { handle: fallback }
        const parsed = MemoryConfig.parse(configured)
        const ref = parsed
          ? decodeModel({ providerID: parsed.providerID, id: parsed.modelID })
          : undefined
        const reason = !ref || ref._tag === "None" ? "invalid model" : undefined
        if (ref && ref._tag === "Some" && (yield* runtime.exists(ref.value))) return { handle: ref.value }
        runtime.warn("memory model config ignored", { reason: reason ?? "model unavailable", model: configured })
        return { handle: fallback, fallback: { reason: reason ?? "model unavailable" } }
      }),
    run: ({ handle, system, prompt, timeoutMs, signal }) =>
      Effect.runPromise(
        runtime.text({ prompt: `${system}\n\n${prompt}`, model: handle as Model.Ref }).pipe(
          Effect.timeoutOrElse({
            duration: Math.max(1, timeoutMs),
            orElse: () => Effect.fail(new DOMException("memory model timed out", "TimeoutError")),
          }),
          Effect.map((text) => ({ text, usage: undefined })),
        ),
        { signal },
      ),
  }
}

/** The latest user message with every assistant step after it, when the last step finished cleanly. */
function latest(messages: readonly Message[]) {
  const index = messages.findLastIndex((item) => item.type === "user")
  if (index < 0) return undefined
  const user = messages[index] as User
  const assistants = messages
    .slice(index + 1)
    .filter((item): item is Assistant => item.type === "assistant" && !item.error)
  const last = assistants[assistants.length - 1]
  if (!last || !last.time.completed) return undefined
  return { user, assistants }
}

function output(message: Assistant) {
  return message.content
    .flatMap((part) => {
      if (part.type === "text") return [part.text.trim()]
      if (part.type === "tool") return [summary(part)]
      return []
    })
    .filter(Boolean)
    .join("\n")
}

function trace(messages: readonly Message[], max: number) {
  return messages
    .flatMap((item) => {
      if (item.type === "user") {
        const body = MemoryRedact.text(item.text.trim())
        return body ? [`User: ${body}`] : []
      }
      if (item.type !== "assistant" || item.error) return []
      const body = output(item)
      return body ? [`Assistant: ${body}`] : []
    })
    .slice(-max)
    .join("\n\n")
}

function hidden(input: string) {
  const text = input.trim().replaceAll(/\s+/g, " ")
  if (!text) return ""
  if (MemoryRedact.has(text)) return "[redacted]"
  return MemoryShared.brief(text, 220)
}

function field(input: Record<string, unknown>, key: string) {
  const value = input[key]
  return typeof value === "string" ? hidden(value) : ""
}

function summary(part: ToolPart) {
  const state = part.state
  const pieces = [`Tool ${part.name} ${state.status}`]
  if (state.status === "streaming") return pieces.join(" | ")
  const title = state.metadata?.title
  if (state.status === "completed" && typeof title === "string" && hidden(title)) pieces.push(`title=${hidden(title)}`)
  for (const [key, label] of [
    ["command", "command"],
    ["filePath", "file"],
    ["path", "file"],
    ["pattern", "pattern"],
    ["query", "query"],
  ] as const) {
    const value = field(state.input, key)
    if (value) pieces.push(`${label}=${value}`)
  }
  const exit = state.status === "completed" ? state.metadata?.exit : undefined
  if (typeof exit === "number" || typeof exit === "string") pieces.push(`exit=${exit}`)
  if (state.status === "error") {
    const error = hidden(state.error.message)
    if (error) pieces.push(`error=${error}`)
  }
  return pieces.join(" | ")
}

/** True when the turn was answered from targeted recall; digesting it would echo memory back into itself. */
function recalled(assistants: readonly Assistant[]) {
  return assistants.some((message) =>
    message.content.some((part) => {
      if (part.type !== "tool" || part.name !== "kilo_memory_recall" || part.state.status !== "completed") return false
      const count = part.state.metadata?.count
      return typeof count === "number" && count > 0
    }),
  )
}

/** The marker of a completed recall tool result. */
export function recallMarker(input: { content: string; metadata?: Record<string, unknown>; tokens: number }) {
  return MemoryMarkerMeta.fromRecall({ output: input.content, metadata: input.metadata, tokens: input.tokens })
}
