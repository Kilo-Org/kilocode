import { generateText, streamText } from "ai"
import { Effect } from "effect"
import { MemoryConfig } from "@kilocode/kilo-memory/effect/config"
import { MemoryError } from "@kilocode/kilo-memory/effect/errors"
import type { MemoryPorts } from "@kilocode/kilo-memory/effect/ports"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"
import { MemoryShared } from "@kilocode/kilo-memory/shared"
import * as Log from "@opencode-ai/core/util/log"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { Provider } from "@/provider/provider"
import { ProviderTransform } from "@/provider/transform"
import type { MessageV2 } from "@/session/message-v2"
import type { Session } from "@/session/session"
import type { SessionSummary } from "@/session/summary"
import type { Snapshot } from "@/snapshot"
import { ModelID, ProviderID } from "@/provider/schema"
import { SessionID } from "@/session/schema"

const log = Log.create({ service: "memory.ports" })

// --- Transcript extraction (host message model -> port TurnView) ------------------------------

function text(parts: MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => MemoryRedact.text(part.text.trim()))
    .filter(Boolean)
    .join("\n\n")
}

function output(parts: MessageV2.Part[]) {
  return parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text.trim()]
      if (part.type === "tool") return [toolSummary(part)]
      return []
    })
    .filter(Boolean)
    .join("\n")
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

function exit(input: Record<string, unknown> | undefined) {
  const value = input?.exit
  if (typeof value !== "number" && typeof value !== "string") return ""
  return String(value)
}

function toolSummary(part: MessageV2.ToolPart) {
  const state = part.state
  const pieces = [`Tool ${part.tool} ${state.status}`]
  const command = field(state.input, "command")
  const file = field(state.input, "filePath")
  const pattern = field(state.input, "pattern")
  const query = field(state.input, "query")
  if (state.status === "completed" || state.status === "running") {
    const title = state.title ? hidden(state.title) : ""
    if (title) pieces.push(`title=${title}`)
  }
  if (command) pieces.push(`command=${command}`)
  if (file) pieces.push(`file=${file}`)
  if (pattern) pieces.push(`pattern=${pattern}`)
  if (query) pieces.push(`query=${query}`)
  if (state.status === "completed") {
    const code = exit(state.metadata)
    if (code) pieces.push(`exit=${code}`)
  }
  if (state.status === "error") {
    const error = hidden(state.error)
    if (error) pieces.push(`error=${error}`)
  }
  return pieces.join(" | ")
}

type UserTurn = MessageV2.WithParts & { info: MessageV2.User }
type AssistantTurn = MessageV2.WithParts & { info: MessageV2.Assistant }
type Turn = {
  user: UserTurn
  assistant: AssistantTurn
  assistants: AssistantTurn[]
}

function trace(messages: MessageV2.WithParts[], max: number) {
  return messages
    .flatMap((item) => {
      if (item.info.role === "user") {
        const body = text(item.parts)
        return body ? [`User: ${body}`] : []
      }
      if (item.info.role !== "assistant" || item.info.summary === true || item.info.error) return []
      const body = output(item.parts)
      return body ? [`Assistant: ${body}`] : []
    })
    .slice(-max)
    .join("\n\n")
}

function latest(messages: MessageV2.WithParts[]): Turn | undefined {
  const assistant = messages.findLast(
    (item): item is AssistantTurn =>
      item.info.role === "assistant" &&
      Boolean(item.info.finish) &&
      item.info.summary !== true &&
      !item.info.error &&
      Boolean(item.info.parentID),
  )
  if (!assistant) return
  const idx = messages.findIndex((item) => item.info.id === assistant.info.parentID)
  const user = idx >= 0 ? messages[idx] : undefined
  if (!user || user.info.role !== "user") return
  const assistants = messages
    .slice(idx + 1)
    .filter(
      (item): item is AssistantTurn =>
        item.info.role === "assistant" &&
        item.info.parentID === user.info.id &&
        item.info.summary !== true &&
        !item.info.error,
    )
  return { user: user as UserTurn, assistant, assistants }
}

/** True when the turn was answered from memory (targeted recall ran); digesting it would echo memory back into itself. */
function recalledMemory(turn: Turn) {
  return [turn.user, ...turn.assistants].flatMap((item) => item.parts).some((part) => {
    if (part.type === "tool") {
      return (
        part.tool === "kilo_memory_recall" &&
        part.state.status === "completed" &&
        typeof part.state.metadata.count === "number" &&
        part.state.metadata.count > 0
      )
    }
    if (part.type !== "text") return false
    const marker = (part.metadata as { kiloMemory?: { type?: string; count?: number } } | undefined)?.kiloMemory
    return marker?.type === "recall" && (marker.count ?? 0) > 0
  })
}

// --- Model resolution + invocation (host provider/`ai` -> port ModelHandle) --------------------

function consolidationOptions(model: Provider.Model) {
  if (model.providerID === "openai" || model.api.npm === "@ai-sdk/openai") return { store: false }
  return ProviderTransform.smallOptions(model)
}

function consolidationPrompt(input: { model: Provider.Model; options: Record<string, unknown>; system: string }) {
  const openai = input.model.providerID === "openai" && input.model.api.npm === "@ai-sdk/openai"
  const options = openai ? { ...input.options, instructions: input.system } : input.options
  return {
    providerOptions: ProviderTransform.providerOptions(input.model, options),
    system: openai ? undefined : input.system,
  }
}

async function memoryText(input: {
  source: Provider.Model
  language: LanguageModelV3
  options: Record<string, unknown>
  system: string
  prompt: string
  timeoutMs: number
  temperature?: number
  topP?: number
  topK?: number
  signal?: AbortSignal
}) {
  const ctl = new AbortController()
  const ms = Math.max(1, input.timeoutMs)
  const params = consolidationPrompt({ model: input.source, options: input.options, system: input.system })
  const openai = input.source.providerID === "openai" && input.source.api.npm === "@ai-sdk/openai"
  const common = {
    model: input.language,
    ...(params.system ? { system: params.system } : {}),
    prompt: input.prompt,
    providerOptions: params.providerOptions,
    abortSignal: input.signal ? AbortSignal.any([ctl.signal, input.signal]) : ctl.signal,
    temperature: input.temperature,
    topP: input.topP,
    topK: input.topK,
  }
  const work = async () => {
    if (!openai) return generateText(common)

    const result = streamText(common)
    const text: string[] = []
    let usage: unknown
    for await (const part of result.fullStream) {
      if (part.type === "text-delta" && part.text) text.push(part.text)
      if (part.type === "finish-step") usage = part.usage
      if (part.type === "finish") usage = part.totalUsage
      if (part.type === "error") throw part.error
    }
    return { text: text.join(""), usage }
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      ctl.abort()
      reject(new Error("memory model timed out"))
    }, ms)
  })
  try {
    return await Promise.race([work(), timeout])
  } finally {
    if (timer) clearTimeout(timer)
    ctl.abort()
  }
}

function modelOptions(model: Provider.Model, language: LanguageModelV3) {
  const options = consolidationOptions(model)
  // No explicit output cap: valid output is already bounded by the compact-JSON prompt, the parser's
  // 64KB guard, and the capture timeout — and some backends reject explicit caps outright.
  const temperature = ProviderTransform.temperature(model)
  const topP = ProviderTransform.topP(model)
  const topK = ProviderTransform.topK(model)
  return { source: model, language, options, temperature, topP, topK }
}

type ModelHandle = ReturnType<typeof modelOptions>

// --- Ports -------------------------------------------------------------------------------------

/** Host SessionPort: extracts a TurnView from opencode's message store + snapshot diffs so the
 * package orchestrator never touches the host message model. */
export namespace MemorySession {
  export function port(input: {
    sessions: Session.Interface
    summary: SessionSummary.Interface
  }): MemoryPorts.SessionPort {
    return {
      readTurn: ({ sessionID, window }) =>
        Effect.gen(function* () {
          const messages = yield* input.sessions.messages({ sessionID: SessionID.make(sessionID), limit: window })
          const turn = latest(messages)
          if (!turn) return undefined
          const diffs = yield* input.summary
            .computeDiff({ messages: [turn.user, ...turn.assistants] })
            .pipe(
              Effect.catch((err) =>
                Effect.sync(() => {
                  log.warn("memory turn diff unavailable", { error: String(err) })
                  return [] as Snapshot.FileDiff[]
                }),
              ),
            )
          return {
            user: text(turn.user.parts),
            assistant: output(turn.assistant.parts),
            recent: trace(messages, 8),
            lastAssistantID: turn.assistant.info.id,
            sessionModel: {
              providerID: turn.user.info.model.providerID,
              modelID: turn.user.info.model.modelID,
            },
            recalledMemory: recalledMemory(turn),
            diffs,
          }
        }).pipe(Effect.mapError(MemoryError.from)),
      get: ({ sessionID }) =>
        input.sessions.get(SessionID.make(sessionID)).pipe(
          Effect.map((info) => ({ parentID: info.parentID })),
          Effect.mapError(MemoryError.from),
        ),
    }
  }
}

/** Host ModelPort: resolves the consolidation model through opencode's provider and runs it via the
 * `ai` SDK, exposing the resolved model to the package as an opaque handle. */
export namespace MemoryModel {
  export function port(input: { provider: Provider.Interface }): MemoryPorts.ModelPort {
    return {
      resolve: ({ configured, session }) =>
        Effect.gen(function* () {
          const parsed = MemoryConfig.parse(configured)
          const sessionModel = () =>
            input.provider.getModel(ProviderID.make(session.providerID), ModelID.make(session.modelID))
          let reason: string | undefined
          let source: Provider.Model
          if (configured && !parsed) {
            reason = "invalid model"
            source = yield* sessionModel()
          } else if (parsed) {
            source = yield* input.provider
              .getModel(ProviderID.make(parsed.providerID), ModelID.make(parsed.modelID))
              .pipe(
                Effect.catch(() =>
                  Effect.sync(() => {
                    reason = "model unavailable"
                  }).pipe(Effect.flatMap(sessionModel)),
                ),
              )
          } else {
            source = yield* sessionModel()
          }
          if (reason) log.warn("memory model config ignored", { reason, model: configured })
          const language = yield* input.provider.getLanguage(source)
          return { handle: modelOptions(source, language), ...(reason ? { fallback: { reason } } : {}) }
        }).pipe(Effect.mapError(MemoryError.from)),
      run: ({ handle, system, prompt, timeoutMs, signal }) => {
        const resolved = handle as ModelHandle
        return memoryText({
          source: resolved.source,
          language: resolved.language,
          options: resolved.options,
          system,
          prompt,
          timeoutMs,
          temperature: resolved.temperature,
          topP: resolved.topP,
          topK: resolved.topK,
          signal,
        })
      },
    }
  }
}
