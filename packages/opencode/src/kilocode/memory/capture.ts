import { generateText, streamText } from "ai"
import { Cause, Effect } from "effect"
import {
  auditOps,
  cap,
  capturePlan,
  digestPrompt,
  digestSchema,
  duplicateOps,
  errorReason,
  evidence,
  fallbackDigest,
  guardReason,
  hasDurableDiff,
  mergeOps,
  notice,
  parseDigest,
  parseJson,
  parseOps,
  skipped,
  summarize,
  summarizeDiffs,
  typedPrompt,
  typedSchema,
  usage,
  verifySkips,
  type CaptureReason,
  type CaptureSkip,
  type CaptureSourceItem,
} from "@kilocode/kilo-memory/capture"
import { MemoryDigest } from "@kilocode/kilo-memory/digest"
import type { MemoryOperations } from "@kilocode/kilo-memory/ops"
import { MemoryRedact } from "@kilocode/kilo-memory/redact"
import { MemorySchema } from "@kilocode/kilo-memory/schema"
import { MemoryShared } from "@kilocode/kilo-memory/shared"
import * as Log from "@opencode-ai/core/util/log"
import type { LanguageModelV3 } from "@ai-sdk/provider"
import { InstanceState } from "@/effect/instance-state"
import { Provider } from "@/provider/provider"
import type { Session } from "@/session/session"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import type { SessionSummary } from "@/session/summary"
import type { Snapshot } from "@/snapshot"
import { ProviderTransform } from "@/provider/transform"
import { MemoryEvents, MemoryPaths } from "."
import { MemoryConfig } from "./config"
import { MemoryService } from "./service"
import { MemoryTimers } from "./timers"

const log = Log.create({ service: "memory.capture" })

function text(parts: MessageV2.Part[]) {
  return parts
    .filter((part): part is MessageV2.TextPart => part.type === "text")
    .filter((part) => !part.synthetic && !part.ignored)
    .map((part) => part.text.trim())
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

export function toolSummary(part: MessageV2.ToolPart) {
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

function latest(messages: MessageV2.WithParts[]) {
  const assistant = messages.findLast(
    (item): item is AssistantTurn =>
      item.info.role === "assistant" &&
      Boolean(item.info.finish) &&
      item.info.summary !== true &&
      !item.info.error &&
      Boolean(item.info.parentID),
  )
  if (!assistant) return
  const user = messages.find((item) => item.info.id === assistant.info.parentID)
  if (!user || user.info.role !== "user") return
  return { user: user as UserTurn, assistant }
}

/** True when the turn was answered from memory (targeted recall ran); digesting it would echo memory back into itself. */
function recalledMemory(turn: { user: MessageV2.WithParts; assistant: MessageV2.WithParts }) {
  return [...turn.user.parts, ...turn.assistant.parts].some((part) => {
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

function provenance(input: { assistant: string }) {
  const assistant = input.assistant.trim()
  const markers = [/\bsystem\s*\/\s*developer\b/gi, /\bagents\.md\b/gi, /\bclaude\.md\b/gi].reduce(
    (sum, item) => sum + (assistant.match(item)?.length ?? 0),
    0,
  )
  const list = assistant.split("\n").filter((line) => /^\s*[-*]\s+\S/.test(line)).length
  return markers >= 4 || (markers >= 3 && list >= 2)
}

export function consolidationOptions(model: Provider.Model) {
  if (model.providerID === "openai" || model.api.npm === "@ai-sdk/openai") return { store: false }
  return ProviderTransform.smallOptions(model)
}

export function consolidationPrompt(input: {
  model: Provider.Model
  options: Record<string, unknown>
  system: string
}) {
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
  maxOutputTokens: number | undefined
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
    maxOutputTokens: input.maxOutputTokens,
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

function typedExisting(memory: MemoryService.Interface, root: string) {
  return memory.sources({ root }).pipe(
    Effect.map((sources) => {
      const blocks = MemorySchema.Sources.map((file) => {
        const body = sources[file].trim()
        if (!body) return ""
        return [`### source ${file}`, body].join("\n")
      })
      return blocks.filter(Boolean).join("\n")
    }),
  )
}

function itemSource(file: MemorySchema.Source, text: string): CaptureSourceItem[] {
  return MemoryShared.source({ file, text })
}

function typedItems(memory: MemoryService.Interface, root: string) {
  return memory
    .sources({ root })
    .pipe(Effect.map((sources) => MemorySchema.Sources.flatMap((file) => itemSource(file, sources[file]))))
}

function modelOptions(model: Provider.Model, language: LanguageModelV3) {
  const options = consolidationOptions(model)
  // No output cap for openai: the ChatGPT OAuth responses backend 400s on max_output_tokens.
  // No 1024 clamp elsewhere: reasoning models reject caps below the thinking budget.
  const maxOutputTokens =
    (model.providerID === "openai" && model.api.npm === "@ai-sdk/openai") ||
    (model.api.npm === "@ai-sdk/openai-compatible" && model.api.id.toLowerCase().includes("gpt-5"))
      ? undefined
      : ProviderTransform.maxOutputTokens(model)
  const temperature = ProviderTransform.temperature(model)
  const topP = ProviderTransform.topP(model)
  const topK = ProviderTransform.topK(model)
  return { source: model, language, options, maxOutputTokens, temperature, topP, topK }
}

export namespace MemoryCapture {
  export const turn = Effect.fn("MemoryCapture.turn")(function* (input: {
    sessionID: SessionID
    sessions: Session.Interface
    summary: SessionSummary.Interface
    provider: Provider.Interface
    reason?: CaptureReason
    bypassInterval?: boolean
    memoryModel?: string
  }) {
    const ctx = yield* InstanceState.context
    const memory = yield* MemoryService.Service
    const root = MemoryPaths.root({ ctx })
    const signal = MemoryTimers.signal(root)
    yield* memory.prepare({ ctx })
    const state = yield* memory.state({ root })
    const reported = new Set<string>()
    const fail = (reason: string) =>
      Effect.promise(async () => {
        const safe = MemoryRedact.text(reason)
        if (reported.has(safe)) return
        reported.add(safe)
        await MemoryEvents.publish({
          event: "error",
          payload: MemoryEvents.status({
            root,
            state,
            phase: "error",
            reason: safe,
            sessionID: input.sessionID,
          }),
        })
      })
    const skip = (reason: string, opts?: { idleFlush?: boolean }) =>
      Effect.gen(function* () {
        if (state.enabled) yield* memory.decide({ root, decision: skipped({ sessionID: input.sessionID, reason }) })
        yield* Effect.promise(() =>
          MemoryEvents.publish({
            event: "status",
            payload: MemoryEvents.status({
              root,
              state,
              phase: "skipped",
              reason,
              sessionID: input.sessionID,
            }),
          }),
        )
        return { root, skipped: true as const, reason, idleFlush: opts?.idleFlush === true }
      })
    if (!state.enabled || !state.capture.turnClose) return yield* skip("disabled")
    const now = Date.now()
    const messages = yield* input.sessions.messages({ sessionID: input.sessionID })
    const turn = latest(messages)
    if (!turn) return yield* skip("no_turn")
    if (input.bypassInterval && state.stats.lastConsolidatedMessageID === turn.assistant.info.id)
      return yield* skip("no_new_content")
    const user = text(turn.user.parts)
    const assistant = output(turn.assistant.parts)
    const recent = trace(messages, 8)
    const summary = summarize({ user, assistant, max: state.limits.maxSessionLineChars })
    const diffs = yield* input.summary
      .computeDiff({ messages: [turn.user, turn.assistant] })
      .pipe(Effect.catch(() => Effect.succeed([] as Snapshot.FileDiff[])))
    const changed = summarizeDiffs(diffs)
    const durable = hasDurableDiff(diffs)
    const completed = !input.reason || input.reason === "completed"
    // Echo = short lookup answered from memory with no file changes. Long recall-assisted answers
    // (research, investigations) carry new content and must still be digested.
    const echo = !durable && assistant.length < 1200 && recalledMemory(turn)
    const sourced = provenance({ assistant })
    const session = completed && !echo && Boolean(summary)
    const prior = session
      ? yield* memory.session({ root, sessionID: input.sessionID, max: state.limits.maxSessionLineChars })
      : undefined
    const priorTime = prior?.time ? Date.parse(prior.time) : 0
    const plan = capturePlan({
      reason: input.reason,
      summary,
      echo,
      durable,
      priorTime,
      now,
      minIntervalMs: state.capture.minIntervalMs,
      lastConsolidatedAt: state.stats.lastConsolidatedAt,
      bypassInterval: input.bypassInterval,
      autoConsolidate: state.autoConsolidate,
    })
    const digestDue = plan.digestDue
    const typedCall = plan.typedCall

    if (plan.skipReason) return yield* skip(plan.skipReason, plan.idleFlush ? { idleFlush: true } : undefined)
    yield* Effect.promise(() =>
      MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({ root, state, phase: "checking", sessionID: input.sessionID }),
      }),
    )

    const model =
      digestDue || typedCall
        ? yield* Effect.gen(function* () {
            const configured = input.memoryModel
            const session = turn.user.info.model
            const fallback = Effect.fn("MemoryCapture.modelFallback")(function* (reason: string) {
              const safe = MemoryRedact.text(reason)
              log.warn("memory model config ignored", { reason: safe, model: configured })
              yield* memory.append({
                root,
                text: `memory_model_config reason=${MemoryShared.brief(safe, 160)} fallback=1`,
              })
              return yield* input.provider.getModel(session.providerID, session.modelID)
            })
            const parsed = MemoryConfig.parse(configured)
            const source =
              configured && !parsed
                ? yield* fallback("invalid model")
                : parsed
                  ? yield* input.provider
                      .getModel(parsed.providerID, parsed.modelID)
                      .pipe(Effect.catch(() => fallback("model unavailable")))
                  : yield* input.provider.getModel(session.providerID, session.modelID)
            const language = yield* input.provider.getLanguage(source)
            return modelOptions(source, language)
          })
        : undefined
    const fallback = MemoryRedact.text(
      fallbackDigest({ prior: prior?.summary, summary, max: state.limits.maxSessionLineChars }),
    )
    const safe = MemoryDigest.empty(fallback) ? "" : fallback
    const digestEffect = digestDue
      ? Effect.gen(function* () {
          const body = cap(
            evidence([
              { title: "latest_user", body: user },
              { title: "latest_assistant", body: assistant || "(no assistant text)" },
              { title: "diff_summary", body: changed || "(none)" },
              { title: "previous_digest", body: prior?.summary },
              { title: "max_characters", body: String(state.limits.maxSessionLineChars) },
            ]),
            state.limits.maxConsolidationInputBytes,
          )
          const result = yield* Effect.tryPromise({
            try: () =>
              memoryText({
                source: model!.source,
                language: model!.language,
                options: model!.options,
                system: digestPrompt,
                prompt: body,
                maxOutputTokens: model!.maxOutputTokens,
                timeoutMs: state.capture.timeoutMs,
                temperature: model!.temperature,
                topP: model!.topP,
                topK: model!.topK,
                signal,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                if (signal.aborted) return { ok: false as const, reason: "cancelled" }
                const raw = errorReason(err)
                const reason = MemoryRedact.text(guardReason(raw) ?? raw)
                yield* fail(reason)
                yield* memory.append({ root, text: `digest error=${MemoryShared.brief(reason, 160)} fallback=1` })
                return { ok: false as const, reason }
              }),
            ),
          )
          if (!result.ok) {
            return {
              topic: "",
              summary: safe,
              tokens: 0,
              reason: result.reason,
            }
          }
          const parsed = yield* Effect.try({
            try: () => parseJson(digestSchema, result.result.text),
            catch: (error) => error,
          }).pipe(
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                const reason = MemoryRedact.text(errorReason(err))
                yield* fail("digest parse_error")
                yield* memory.append({
                  root,
                  text: `digest parse_error=${MemoryShared.brief(reason, 160)} fallback=1`,
                })
                return undefined
              }),
            ),
          )
          if (!parsed) {
            return { topic: "", summary: safe, tokens: usage(result.result.usage), reason: "parse_error" }
          }
          const parsedDigest = parseDigest(parsed, fallback, state.limits.maxSessionLineChars)
          return {
            topic: MemoryRedact.text(parsedDigest.topic),
            summary: MemoryRedact.text(parsedDigest.summary),
            tokens: usage(result.result.usage),
            reason: undefined as string | undefined,
          }
        })
      : Effect.succeed({
          topic: "",
          summary: "",
          tokens: 0,
          reason: undefined as string | undefined,
        })
    const typedEffect = typedCall
      ? Effect.gen(function* () {
          if (sourced) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: 0,
              fallback: false,
              reason: undefined as string | undefined,
              skipped: [
                {
                  reason: "out_of_scope" as const,
                  text: "Instruction/source provenance answers are not durable project memory.",
                },
              ] satisfies CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const existing = yield* typedExisting(memory, root)
          const items = yield* typedItems(memory, root)
          const sessions = yield* memory.recent({
            root,
            limit: state.limits.maxSessionFiles,
            max: state.limits.maxSessionLineChars,
          })
          const body = cap(
            evidence([
              { title: "close_reason", body: input.reason ?? "completed" },
              { title: "latest_user", body: user },
              { title: "latest_assistant", body: assistant || "(no assistant text)" },
              { title: "diff_summary", body: changed || "(none)" },
              { title: "existing_memory", body: existing },
              { title: "recent_session_context", body: recent },
              {
                title: "recent_memory_digests",
                body: sessions
                  .map((item) => `${item.file} session=${item.id} ${item.time} :: ${item.summary}`)
                  .join("\n"),
              },
            ]),
            state.limits.maxConsolidationInputBytes,
          )
          const result = yield* Effect.tryPromise({
            try: () =>
              memoryText({
                source: model!.source,
                language: model!.language,
                options: model!.options,
                system: typedPrompt,
                prompt: body,
                maxOutputTokens: model!.maxOutputTokens,
                timeoutMs: state.capture.timeoutMs,
                temperature: model!.temperature,
                topP: model!.topP,
                topK: model!.topK,
                signal,
              }),
            catch: (error) => error,
          }).pipe(
            Effect.map((result) => ({ ok: true as const, result })),
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                if (signal.aborted) return { ok: false as const, reason: "cancelled" }
                const raw = errorReason(err)
                const reason = MemoryRedact.text(guardReason(raw) ?? raw)
                yield* fail(reason)
                yield* memory.append({ root, text: `consolidate error=${MemoryShared.brief(reason, 160)}` })
                return { ok: false as const, reason }
              }),
            ),
          )
          if (!result.ok) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: 0,
              fallback: true,
              reason: result.reason,
              skipped: [] as CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const parsed = yield* Effect.try({
            try: () => parseJson(typedSchema, result.result.text),
            catch: (error) => error,
          }).pipe(
            Effect.catch((err: unknown) =>
              Effect.gen(function* () {
                const reason = MemoryRedact.text(errorReason(err))
                yield* fail("consolidate parse_error")
                yield* memory.append({ root, text: `consolidate parse_error=${MemoryShared.brief(reason, 160)}` })
                return undefined
              }),
            ),
          )
          if (!parsed) {
            return {
              ops: [] as MemoryOperations.Op[],
              tokens: usage(result.result.usage),
              fallback: true,
              reason: "parse_error",
              skipped: [] as CaptureSkip[],
              fallbackOperationCount: 0,
            }
          }
          const verified = verifySkips({ skipped: parsed.skipped, items })
          const deduped = duplicateOps({ ops: parseOps(parsed), skipped: verified.skipped, items })
          return {
            ops: [...deduped.ops, ...verified.rescued],
            tokens: usage(result.result.usage),
            fallback: false,
            reason: undefined as string | undefined,
            skipped: deduped.skipped,
            fallbackOperationCount: 0,
          }
        })
      : Effect.succeed({
          ops: [] as MemoryOperations.Op[],
          tokens: 0,
          fallback: false,
          reason: undefined as string | undefined,
          skipped: [] as CaptureSkip[],
          fallbackOperationCount: 0,
        })
    // Digest and typed consolidation are independent model calls; run them concurrently.
    const [digest, generated] = yield* Effect.all([digestEffect, typedEffect], { concurrency: 2 })
    if (signal.aborted) return yield* skip("cancelled")
    if (digest.summary) {
      yield* memory.recordSession({
        ctx,
        sessionID: input.sessionID,
        topic: digest.topic,
        summary: digest.summary,
        time: now,
        tokens: digest.tokens,
      })
    }
    if (digestDue) {
      yield* memory.decide({
        root,
        decision: {
          kind: "digest",
          trigger: "turn-close",
          sessionID: input.sessionID,
          result: digest.reason ? "fallback" : digest.summary ? "saved" : "skipped",
          llm: true,
          parsed: Boolean(digest.summary && !digest.reason),
          fallback: Boolean(digest.reason),
          reason: digest.reason,
          tokens: digest.tokens,
          operationCount: digest.summary ? 1 : 0,
          skippedCount: digest.summary ? 0 : 1,
          summary: digest.reason
            ? `session digest used fallback after ${digest.reason}`
            : digest.summary
              ? "session digest saved"
              : "session digest skipped",
        },
      })
    }

    const ops = mergeOps(generated.ops)
      .filter((item) => item.action !== "remove")
      .slice(0, state.capture.maxOpsPerRun)
    const project =
      ops.length > 0 ? yield* memory.apply({ ctx, ops, trigger: "turn-close", tokens: generated.tokens }) : undefined
    const count = project?.operationCount ?? 0
    if (typedCall) {
      yield* memory.decide({
        root,
        decision: {
          kind: "typed",
          trigger: "turn-close",
          sessionID: input.sessionID,
          result: generated.fallback ? "fallback" : count > 0 ? "saved" : "skipped",
          llm: true,
          parsed: !generated.fallback,
          fallback: generated.fallback,
          reason: generated.reason,
          tokens: generated.tokens,
          operationCount: count,
          skippedCount: generated.skipped.length,
          fallbackOperationCount: generated.fallbackOperationCount,
          skipped: generated.skipped,
          operations: auditOps(ops),
          files: [...new Set(ops.flatMap((item) => (item.action === "add" && item.file ? [item.file] : [])))],
          summary: generated.fallback
            ? `typed consolidation skipped after ${generated.reason ?? "model failure"}`
            : count > 0
              ? `typed consolidation saved ${count} ops`
              : `typed consolidation skipped ${generated.skipped.length} candidates`,
        },
      })
    }
    const tokens = digest.tokens + generated.tokens
    if (!digest.summary && !typedCall && count === 0) return yield* skip("no_ops")
    if ((digestDue || typedCall || count > 0) && (!typedCall || !generated.fallback)) {
      yield* memory.commit({
        root,
        now,
        messageID: turn.assistant.info.id,
        tokens,
        count,
        digest: Boolean(digest.summary),
        skipped: generated.skipped,
      })
    }
    const updated = yield* memory.state({ root })
    const index = project?.index ?? (yield* memory.index({ root }))
    const detail = typedCall
      ? notice({
          count,
          ops,
          skipped: generated.skipped,
          tokens: generated.tokens,
        })
      : undefined
    yield* Effect.promise(() =>
      MemoryEvents.publish({
        event: "status",
        payload: MemoryEvents.status({
          root,
          state: updated,
          index,
          phase: "idle",
          sessionID: input.sessionID,
          consolidation: { trigger: "turn-close", operationCount: count, cost: 0, tokens },
          ...(detail ? { detail } : {}),
        }),
      }),
    )
    return { root, skipped: false as const, operationCount: count, tokens }
  })

  export function report(cause: Cause.Cause<unknown>) {
    // Brief message only: API errors carry response headers/bodies that would flood the TUI log.
    const err = Cause.squash(cause)
    log.warn("memory capture failed", {
      err: (err instanceof Error ? err.message : String(err)).slice(0, 200),
    })
  }
}
