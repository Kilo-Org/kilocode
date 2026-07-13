import { Image } from "@/image/image"
import { Cause, Deferred, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import * as Session from "./session"
import { LLM } from "./llm"
import { MessageV2 } from "./message-v2"
import { isOverflow } from "./overflow"
import { PartID } from "./schema"
import type { SessionID } from "./schema"
import { SessionRetry } from "./retry"
import { SessionStatus } from "./status"
import { SessionSummary } from "./summary"
import type { Provider } from "@/provider/provider"
import { Question } from "@/question"
// kilocode_change start
import { KiloSessionProcessor, type ReviewTelemetry } from "@/kilocode/session/processor"
import { KiloSessionOverflow } from "@/kilocode/session/overflow"
import { KiloRoutedModel } from "@/kilocode/session/routed-model"
import { Suggestion } from "@/kilocode/suggestion"
// kilocode_change end
import { errorMessage } from "@/util/error"
import * as Log from "@opencode-ai/core/util/log"
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@opencode-ai/core/session-event"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as DateTime from "effect/DateTime"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Usage, type LLMEvent } from "@opencode-ai/llm"

const DOOM_LOOP_THRESHOLD = 3
const log = Log.create({ service: "session.processor" })

export type Result = "compact" | "stop" | "continue"

export interface Handle {
  readonly message: MessageV2.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
  ) => Effect.Effect<MessageV2.ToolPart | undefined>
  // kilocode_change start
  readonly metadata: (
    toolCallID: string,
    input: { title?: string; metadata?: Record<string, any> },
  ) => Effect.Effect<void>
  // kilocode_change end
  readonly completeToolCall: (
    toolCallID: string,
    output: {
      title: string
      metadata: Record<string, any>
      output: string
      attachments?: MessageV2.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
  readonly compactError?: () => ReturnType<typeof MessageV2.ContextOverflowError.prototype.toObject> | undefined // kilocode_change
}

type Input = {
  assistantMessage: MessageV2.Assistant
  sessionID: SessionID
  model: Provider.Model
  // kilocode_change start
  telemetry?: ReviewTelemetry
  snapshotInitialization?: "wait"
  // kilocode_change end
}

export interface Interface {
  readonly create: (input: Input) => Effect.Effect<Handle>
}

type ToolCall = {
  partID: MessageV2.ToolPart["id"]
  messageID: MessageV2.ToolPart["messageID"]
  sessionID: MessageV2.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
  inputEnded: boolean
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  toolmeta: Record<string, { title?: string; metadata?: Record<string, any> }> // kilocode_change
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  compactionError: ReturnType<typeof MessageV2.ContextOverflowError.prototype.toObject> | undefined // kilocode_change
  currentText: MessageV2.TextPart | undefined
  reasoningMap: Record<string, MessageV2.ReasoningPart>
  // kilocode_change start
  stepStart: number
  step: { reasoning: boolean; text: boolean; tool: boolean }
  // kilocode_change end
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
    const bus = yield* Bus.Service
    const snapshot = yield* Snapshot.Service
    const agents = yield* Agent.Service
    const llm = yield* LLM.Service
    const permission = yield* Permission.Service
    const plugin = yield* Plugin.Service
    const summary = yield* SessionSummary.Service
    const scope = yield* Scope.Scope
    const status = yield* SessionStatus.Service
    const image = yield* Image.Service
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service

    const create = Effect.fn("SessionProcessor.create")(function* (input: Input) {
      // Pre-capture snapshot before the LLM stream starts. The AI SDK
      // may execute tools internally before emitting start-step events,
      // so capturing inside the event handler can be too late.
      // kilocode_change start - pass turn context for slow-snapshot UI/policy handling
      const initialSnapshot = yield* snapshot.track({
        sessionID: input.sessionID,
        messageID: input.assistantMessage.id,
        snapshotInitialization: input.snapshotInitialization,
      })
      // kilocode_change end
      const ctx: ProcessorContext = {
        assistantMessage: input.assistantMessage,
        sessionID: input.sessionID,
        model: input.model,
        toolcalls: {},
        toolmeta: {}, // kilocode_change
        shouldBreak: false,
        snapshot: initialSnapshot,
        blocked: false,
        needsCompaction: false,
        compactionError: undefined, // kilocode_change
        currentText: undefined,
        reasoningMap: {},
        // kilocode_change start
        telemetry: input.telemetry,
        stepStart: 0,
        step: { reasoning: false, text: false, tool: false },
        // kilocode_change end
      }
      let aborted = false
      const ac = new AbortController() // kilocode_change — abort controller for offline handler
      const slog = log.clone().tag("session.id", input.sessionID).tag("messageID", input.assistantMessage.id)

      // kilocode_change start
      const parse = (e: unknown) =>
        KiloSessionProcessor.parseError(e, {
          providerID: input.model.providerID,
          aborted,
        })
      // kilocode_change end

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        delete ctx.toolmeta[toolCallID] // kilocode_change
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const readToolCall = Effect.fn("SessionProcessor.readToolCall")(function* (toolCallID: string) {
        const call = ctx.toolcalls[toolCallID]
        if (!call) return undefined
        const part = yield* session.getPart({
          partID: call.partID,
          messageID: call.messageID,
          sessionID: call.sessionID,
        })
        if (!part || part.type !== "tool") {
          delete ctx.toolcalls[toolCallID]
          delete ctx.toolmeta[toolCallID] // kilocode_change
          return undefined
        }
        return { call, part }
      })

      // kilocode_change start - tolerate deleted sessions during subagent cost reconciliation (#6321)
      const reconcile = Effect.fn("SessionProcessor.reconcileCost")(function* () {
        const fresh = yield* MessageV2.get({
          sessionID: ctx.assistantMessage.sessionID,
          messageID: ctx.assistantMessage.id,
        }).pipe(Effect.catchTag("NotFoundError", () => Effect.void))
        if (fresh?.info.role !== "assistant") return
        if (fresh.info.cost <= ctx.assistantMessage.cost) return
        ctx.assistantMessage.cost = fresh.info.cost
      })
      // kilocode_change end

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: MessageV2.ToolPart) => MessageV2.ToolPart,
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match) return undefined
        const part = yield* session.updatePart(update(match.part))
        ctx.toolcalls[toolCallID] = {
          ...match.call,
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
        }
        return part
      })

      // kilocode_change start - buffer metadata emitted before tool-call registration
      const metadata = Effect.fn("SessionProcessor.metadata")(function* (
        toolCallID: string,
        input: { title?: string; metadata?: Record<string, any> },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") {
          ctx.toolmeta[toolCallID] = {
            ...ctx.toolmeta[toolCallID],
            ...input,
          }
          return
        }
        yield* updateToolCall(toolCallID, (part) => {
          if (part.state.status !== "running") return part
          return {
            ...part,
            state: {
              ...part.state,
              title: input.title ?? part.state.title,
              metadata: input.metadata ?? part.state.metadata,
            },
          }
        })
      })
      // kilocode_change end

      const completeToolCall = Effect.fn("SessionProcessor.completeToolCall")(function* (
        toolCallID: string,
        output: {
          title: string
          metadata: Record<string, any>
          output: string
          attachments?: MessageV2.FilePart[]
        },
      ) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "completed",
            input: match.part.state.input,
            output: output.output,
            metadata: output.metadata,
            title: output.title,
            time: { start: match.part.state.time.start, end: Date.now() },
            attachments: output.attachments,
          },
        })
        // kilocode_change start - accepted suggest review actions tag following LLM completion telemetry
        if (match.part.tool === "suggest") {
          ctx.telemetry = KiloSessionProcessor.suggestionReviewTelemetry(output.metadata) ?? ctx.telemetry
        }
        // kilocode_change end
        yield* settleToolCall(toolCallID)
      })

      const failToolCall = Effect.fn("SessionProcessor.failToolCall")(function* (toolCallID: string, error: unknown) {
        const match = yield* readToolCall(toolCallID)
        if (!match || match.part.state.status !== "running") return false
        yield* session.updatePart({
          ...match.part,
          state: {
            status: "error",
            input: match.part.state.input,
            error: errorMessage(error),
            metadata: match.part.state.metadata, // kilocode_change - preserve running tool metadata on failure
            time: { start: match.part.state.time.start, end: Date.now() },
          },
        })
        // kilocode_change start
        if (
          error instanceof Permission.RejectedError ||
          error instanceof Question.RejectedError ||
          error instanceof Suggestion.DismissedError
        ) {
          // kilocode_change end
          ctx.blocked = ctx.shouldBreak
        }
        yield* settleToolCall(toolCallID)
        return true
      })

      const finishReasoning = Effect.fn("SessionProcessor.finishReasoning")(function* (reasoningID: string) {
        if (!(reasoningID in ctx.reasoningMap)) return
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Reasoning.Ended, {
            sessionID: ctx.sessionID,
            reasoningID,
            text: ctx.reasoningMap[reasoningID].text,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const ensureToolCall = Effect.fn("SessionProcessor.ensureToolCall")(function* (input: {
        id: string
        name: string
        providerExecuted?: boolean
      }) {
        const existing = yield* readToolCall(input.id)
        if (existing) {
          if (!input.providerExecuted || existing.part.metadata?.providerExecuted) return existing
          const part = yield* session.updatePart({
            ...existing.part,
            metadata: { ...existing.part.metadata, providerExecuted: true },
          })
          ctx.toolcalls[input.id] = {
            ...existing.call,
            partID: part.id,
            messageID: part.messageID,
            sessionID: part.sessionID,
          }
          return { call: ctx.toolcalls[input.id], part }
        }
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Tool.Input.Started, {
            sessionID: ctx.sessionID,
            callID: input.id,
            name: input.name,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        const part = yield* session.updatePart({
          id: PartID.ascending(),
          messageID: ctx.assistantMessage.id,
          sessionID: ctx.assistantMessage.sessionID,
          type: "tool",
          tool: input.name,
          callID: input.id,
          state: { status: "pending", input: {}, raw: "" },
          metadata: input.providerExecuted ? { providerExecuted: true } : undefined,
        } satisfies MessageV2.ToolPart)
        ctx.toolcalls[input.id] = {
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          inputEnded: false,
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is MessageV2.FilePart => Schema.is(MessageV2.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: MessageV2.FilePart[] } => {
        if (isRecord(value.result.value) && typeof value.result.value.output === "string") {
          return {
            title: typeof value.result.value.title === "string" ? value.result.value.title : value.name,
            metadata: isRecord(value.result.value.metadata) ? value.result.value.metadata : {},
            output: value.result.value.output,
            attachments: Array.isArray(value.result.value.attachments)
              ? value.result.value.attachments.filter(isFilePart)
              : undefined,
          }
        }
        return {
          title: value.name,
          metadata: value.result.type === "json" && isRecord(value.result.value) ? value.result.value : {},
          output:
            typeof value.result.value === "string" ? value.result.value : (JSON.stringify(value.result.value) ?? ""),
        }
      }

      const toolInput = (value: unknown): Record<string, any> => (isRecord(value) ? value : { value })

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        switch (value.type) {
          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            ctx.step.reasoning = true // kilocode_change
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Reasoning.Started, {
                sessionID: ctx.sessionID,
                reasoningID: value.id,
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            ctx.reasoningMap[value.id] = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "reasoning",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.reasoningMap[value.id])
            return

          case "reasoning-delta":
            // Match dev: silently drop orphan deltas (no preceding reasoning-start).
            if (!(value.id in ctx.reasoningMap)) return
            ctx.reasoningMap[value.id].text += value.text
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.reasoningMap[value.id].sessionID,
              messageID: ctx.reasoningMap[value.id].messageID,
              partID: ctx.reasoningMap[value.id].id,
              field: "text",
              delta: value.text,
            })
            return

          case "reasoning-end":
            if (value.providerMetadata && value.id in ctx.reasoningMap) {
              ctx.reasoningMap[value.id].metadata = value.providerMetadata
            }
            yield* finishReasoning(value.id)
            return

          case "tool-input-start":
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            ctx.step.tool = true // kilocode_change
            yield* ensureToolCall(value)
            return

          case "tool-input-delta":
            // AI SDK emits a final `tool-call` with the parsed `input`; accumulating
            // delta fragments into `state.raw` is redundant work for no current consumer.
            return

          case "tool-input-end": {
            const toolCall = yield* ensureToolCall(value)
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Input.Ended, {
                sessionID: ctx.sessionID,
                callID: value.id,
                text: "",
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            ctx.toolcalls[value.id] = { ...toolCall.call, inputEnded: true }
            return
          }

          case "tool-call": {
            if (ctx.assistantMessage.summary) {
              throw new Error(`Tool call not allowed while generating summary: ${value.name}`)
            }
            // kilocode_change start
            ctx.step.tool = true
            // kilocode_change end
            const toolCall = yield* ensureToolCall(value)
            const input = toolInput(value.input)
            if (!toolCall.call.inputEnded) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Tool.Input.Ended, {
                  sessionID: ctx.sessionID,
                  callID: value.id,
                  text: "",
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Called, {
                sessionID: ctx.sessionID,
                callID: value.id,
                tool: value.name,
                input,
                provider: {
                  executed: toolCall.part.metadata?.providerExecuted === true,
                  ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            // kilocode_change start - apply metadata buffered before the running transition
            const meta = ctx.toolmeta[value.id]
            yield* updateToolCall(value.id, (match) => ({
              ...match,
              tool: value.name,
              state:
                match.state.status === "running"
                  ? {
                      ...match.state,
                      input,
                      title: meta?.title ?? match.state.title,
                      metadata: meta?.metadata ?? match.state.metadata,
                    }
                  : {
                      status: "running",
                      input,
                      title: meta?.title,
                      metadata: meta?.metadata,
                      time: { start: Date.now() },
                    },
              metadata: match.metadata?.providerExecuted
                ? { ...value.providerMetadata, providerExecuted: true }
                : value.providerMetadata,
            }))
            delete ctx.toolmeta[value.id]
            // kilocode_change end

            const parts = MessageV2.parts(ctx.assistantMessage.id)
            const recentParts = parts.slice(-DOOM_LOOP_THRESHOLD)

            if (
              recentParts.length !== DOOM_LOOP_THRESHOLD ||
              !recentParts.every(
                (part) =>
                  part.type === "tool" &&
                  part.tool === value.name &&
                  part.state.status !== "pending" &&
                  JSON.stringify(part.state.input) === JSON.stringify(input),
              )
            ) {
              return
            }

            const agent = yield* agents.get(ctx.assistantMessage.agent)
            yield* permission.ask({
              permission: "doom_loop",
              patterns: [value.name],
              sessionID: ctx.assistantMessage.sessionID,
              metadata: { tool: value.name, input },
              always: [value.name],
              ruleset: agent.permission,
            })
            return
          }

          case "tool-result": {
            const toolCall = yield* readToolCall(value.id)
            const rawOutput = toolResultOutput(value)
            const normalized = yield* Effect.forEach(rawOutput.attachments ?? [], (attachment) =>
              attachment.mime.startsWith("image/")
                ? image.normalize(attachment).pipe(
                    Effect.catchIf(
                      (error) => error instanceof Image.ResizerUnavailableError,
                      () => Effect.succeed(attachment),
                    ),
                    Effect.exit,
                  )
                : Effect.succeed(Exit.succeed<MessageV2.FilePart>(attachment)),
            )
            const omitted = normalized.filter(Exit.isFailure).length
            const attachments = normalized.filter(Exit.isSuccess).map((item) => item.value)
            const output = {
              ...rawOutput,
              output:
                omitted === 0
                  ? rawOutput.output
                  : `${rawOutput.output}\n\n[${omitted} image${omitted === 1 ? "" : "s"} omitted: could not be resized below the image size limit.]`,
              attachments: attachments.length ? attachments : undefined,
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Success, {
                sessionID: ctx.sessionID,
                callID: value.id,
                structured: output.metadata,
                content: [
                  {
                    type: "text",
                    text: output.output,
                  },
                  ...(output.attachments?.map((item: MessageV2.FilePart) => ({
                    type: "file" as const,
                    uri: item.url,
                    mime: item.mime,
                    name: item.filename,
                  })) ?? []),
                ],
                provider: {
                  executed: value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true,
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            yield* completeToolCall(value.id, output)
            // kilocode_change start - dismissed suggestions stop the turn after persisting normalized output
            if (output.metadata?.dismissed === true) {
              ctx.blocked = ctx.shouldBreak
            }
            // kilocode_change end
            return
          }

          case "tool-error": {
            const toolCall = yield* readToolCall(value.id)
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Tool.Failed, {
                sessionID: ctx.sessionID,
                callID: value.id,
                error: {
                  type: "unknown",
                  message: value.message,
                },
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true,
                },
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
            yield* failToolCall(value.id, value.error ?? new Error(value.message))
            return
          }

          case "provider-error":
            throw new Error(value.message)

          case "step-start":
            // kilocode_change start
            ctx.stepStart = performance.now()
            ctx.step = { reasoning: false, text: false, tool: false }
            if (!ctx.snapshot)
              ctx.snapshot = yield* snapshot.track({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                snapshotInitialization: input.snapshotInitialization,
              })
            // kilocode_change end
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Step.Started, {
                  sessionID: ctx.sessionID,
                  agent: input.assistantMessage.agent,
                  model: {
                    id: ModelV2.ID.make(ctx.model.id),
                    providerID: ProviderV2.ID.make(ctx.model.providerID),
                    variant: ModelV2.VariantID.make(input.assistantMessage.variant ?? "default"),
                  },
                  snapshot: ctx.snapshot,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
            })
            return

          case "step-finish": {
            // kilocode_change start - pass turn context for slow-snapshot UI/policy handling
            const completedSnapshot = yield* snapshot.track({
              sessionID: ctx.sessionID,
              messageID: ctx.assistantMessage.id,
              snapshotInitialization: input.snapshotInitialization,
            })
            // kilocode_change end
            yield* Effect.forEach(Object.keys(ctx.reasoningMap), finishReasoning)
            const usage = Session.getUsage({
              model: ctx.model,
              usage: value.usage ?? new Usage({}),
              metadata: value.providerMetadata,
            })
            // kilocode_change start
            const model = KiloRoutedModel.readAuto(value.providerMetadata, {
              providerID: ctx.model.providerID,
              modelID: ctx.model.id,
              selected: ctx.assistantMessage.modelID,
            })
            // kilocode_change end
            // kilocode_change start - guard against finish-step without start-step:
            // ctx.stepStart is 0 until `start-step` fires, which would feed a
            // huge bogus `elapsed` into telemetry. Fall back to now().
            KiloSessionProcessor.trackStep({
              sessionID: ctx.sessionID,
              model: ctx.model,
              tokens: usage.tokens,
              cost: usage.cost,
              elapsed: Math.round(performance.now() - (ctx.stepStart || performance.now())),
              telemetry: ctx.telemetry,
            })
            // kilocode_change end
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Step.Ended, {
                  sessionID: ctx.sessionID,
                  finish: value.reason,
                  cost: usage.cost,
                  tokens: usage.tokens,
                  snapshot: completedSnapshot,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            ctx.assistantMessage.finish = value.reason
            // kilocode_change start - capture any subagent cost propagated by tool calls during this step (#6321)
            yield* reconcile()
            // kilocode_change end
            ctx.assistantMessage.cost += usage.cost
            ctx.assistantMessage.tokens = usage.tokens
            yield* session.updatePart({
              id: PartID.ascending(),
              reason: value.reason,
              snapshot: completedSnapshot,
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "step-finish",
              ...(model ? { model } : {}), // kilocode_change
              tokens: usage.tokens,
              cost: usage.cost,
            })
            // kilocode_change start - surface output limit stops, with a stronger message for reasoning-only stops
            const warn = KiloSessionProcessor.lengthWarning({ msg: ctx.assistantMessage, step: ctx.step })
            if (warn) {
              yield* session.updatePart({
                id: PartID.ascending(),
                messageID: ctx.assistantMessage.id,
                sessionID: ctx.assistantMessage.sessionID,
                type: "text",
                text: warn,
                ignored: true,
              })
            }
            const providerError = KiloSessionProcessor.providerFinishError(ctx.assistantMessage)
            if (providerError) {
              yield* bus.publish(Session.Event.Error, {
                sessionID: ctx.assistantMessage.sessionID,
                error: providerError,
              })
              yield* status.set(ctx.sessionID, { type: "idle" })
            }
            // kilocode_change end
            yield* session.updateMessage(ctx.assistantMessage)
            if (ctx.snapshot) {
              const patch = yield* snapshot.patch(ctx.snapshot)
              if (patch.files.length) {
                yield* session.updatePart({
                  id: PartID.ascending(),
                  messageID: ctx.assistantMessage.id,
                  sessionID: ctx.sessionID,
                  type: "patch",
                  hash: patch.hash,
                  files: patch.files,
                })
              }
              ctx.snapshot = undefined
            }
            yield* summary
              .summarize({
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.parentID,
              })
              .pipe(Effect.ignore, Effect.forkIn(scope))
            if (
              !ctx.assistantMessage.summary &&
              // kilocode_change start
              isOverflow({
                cfg: yield* config.get(),
                tokens: usage.tokens,
                model: ctx.model,
                outputTokenMax: flags.outputTokenMax,
              })
              // kilocode_change end
            ) {
              ctx.needsCompaction = true
              // kilocode_change start
              ctx.compactionError = new MessageV2.ContextOverflowError({
                message: "Input exceeds context window of this model",
              }).toObject()
              // kilocode_change end
            }
            return
          }

          case "text-start":
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Text.Started, {
                  sessionID: ctx.sessionID,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            ctx.currentText = {
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.assistantMessage.sessionID,
              type: "text",
              text: "",
              time: { start: Date.now() },
              metadata: value.providerMetadata,
            }
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.text.trim()) ctx.step.text = true // kilocode_change
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePartDelta({
              sessionID: ctx.currentText.sessionID,
              messageID: ctx.currentText.messageID,
              partID: ctx.currentText.id,
              field: "text",
              delta: value.text,
            })
            return

          case "text-end":
            if (!ctx.currentText) return
            // oxlint-disable-next-line no-self-assign -- reactivity trigger
            ctx.currentText.text = ctx.currentText.text
            ctx.currentText.text = (yield* plugin.trigger(
              "experimental.text.complete",
              {
                sessionID: ctx.sessionID,
                messageID: ctx.assistantMessage.id,
                partID: ctx.currentText.id,
              },
              { text: ctx.currentText.text },
            )).text
            if (ctx.currentText.text.trim()) ctx.step.text = true // kilocode_change
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Text.Ended, {
                  sessionID: ctx.sessionID,
                  text: ctx.currentText.text,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            {
              const end = Date.now()
              ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
            }
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            yield* session.updatePart(ctx.currentText)
            ctx.currentText = undefined
            return

          case "finish":
            return
        }
      })

      const cleanup = Effect.fn("SessionProcessor.cleanup")(function* () {
        if (ctx.snapshot) {
          const patch = yield* snapshot.patch(ctx.snapshot)
          if (patch.files.length) {
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              type: "patch",
              hash: patch.hash,
              files: patch.files,
            })
          }
          ctx.snapshot = undefined
        }

        if (ctx.currentText) {
          const end = Date.now()
          ctx.currentText.time = { start: ctx.currentText.time?.start ?? end, end }
          yield* session.updatePart(ctx.currentText)
          ctx.currentText = undefined
        }

        for (const part of Object.values(ctx.reasoningMap)) {
          const end = Date.now()
          yield* session.updatePart({
            ...part,
            time: { start: part.time.start ?? end, end },
          })
        }
        ctx.reasoningMap = {}

        yield* Effect.forEach(
          Object.values(ctx.toolcalls),
          (call) => Deferred.await(call.done).pipe(Effect.timeout("250 millis"), Effect.ignore),
          { concurrency: "unbounded" },
        )

        for (const toolCallID of Object.keys(ctx.toolcalls)) {
          const match = yield* readToolCall(toolCallID)
          if (!match) continue
          const part = match.part
          const end = Date.now()
          const metadata = "metadata" in part.state && isRecord(part.state.metadata) ? part.state.metadata : {}
          yield* session.updatePart({
            ...part,
            state: {
              ...part.state,
              status: "error",
              error: "Tool execution aborted",
              metadata: { ...metadata, interrupted: true },
              time: { start: "time" in part.state ? part.state.time.start : end, end },
            },
          })
        }
        ctx.toolcalls = {}
        ctx.toolmeta = {} // kilocode_change
        KiloSessionProcessor.guardEmptyToolCalls(ctx.assistantMessage, MessageV2.parts(ctx.assistantMessage.id)) // kilocode_change
        ctx.assistantMessage.time.completed = Date.now()
        // kilocode_change start - reconcile cost with any subagent propagation written during tool calls (#6321)
        yield* reconcile()
        // kilocode_change end
        yield* session.updateMessage(ctx.assistantMessage)
      })

      const halt = Effect.fn("SessionProcessor.halt")(function* (e: unknown) {
        // kilocode_change start - internal preflight signal, not a provider error
        if (e instanceof KiloSessionOverflow.PreflightError) {
          ctx.needsCompaction = true
          return
        }
        // kilocode_change end
        slog.error("process", { error: errorMessage(e), stack: e instanceof Error ? e.stack : undefined })
        const error = parse(e)
        // kilocode_change start
        ctx.compactionError = MessageV2.ContextOverflowError.isInstance(error) ? error : ctx.compactionError
        // kilocode_change end
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          ctx.needsCompaction = true
          yield* bus.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        if (!ctx.assistantMessage.summary) {
          // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
          if (flags.experimentalEventSystem) {
            yield* events.publish(SessionEvent.Step.Failed, {
              sessionID: ctx.sessionID,
              error: {
                type: "unknown",
                message: errorMessage(e),
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
          }
        }
        ctx.assistantMessage.error = error
        yield* bus.publish(Session.Event.Error, {
          sessionID: ctx.assistantMessage.sessionID,
          error: ctx.assistantMessage.error,
        })
        yield* status.set(ctx.sessionID, { type: "idle" })
      })

      // kilocode_change start
      const output = {
        compactError: () => ctx.compactionError,
      }
      // kilocode_change end

      const process = Effect.fn("SessionProcessor.process")(function* (streamInput: LLM.StreamInput) {
        slog.info("process")
        ctx.needsCompaction = false
        ctx.compactionError = undefined // kilocode_change
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          yield* Effect.gen(function* () {
            // kilocode_change start
            ctx.currentText = undefined
            ctx.reasoningMap = {}
            ctx.assistantMessage.finish = undefined
            // kilocode_change end
            yield* status.set(ctx.sessionID, { type: "busy" })
            // kilocode_change start
            ctx.step = { reasoning: false, text: false, tool: false }
            const stream = llm.stream({
              ...streamInput,
              preflight: !ctx.assistantMessage.summary,
            })
            // kilocode_change end

            // kilocode_change start
            yield* stream.pipe(
              Stream.tap((event) => handleEvent(event)),
              Stream.takeUntil(() => ctx.needsCompaction),
              Stream.runDrain,
            )
            yield* KiloSessionProcessor.ensureFinish(ctx.assistantMessage)
            // kilocode_change end
          }).pipe(
            Effect.onInterrupt(() =>
              Effect.gen(function* () {
                aborted = true
                ac.abort() // kilocode_change — also abort offline handler
                if (!ctx.assistantMessage.error) {
                  yield* halt(new DOMException("Aborted", "AbortError"))
                }
              }),
            ),
            Effect.catchCauseIf(
              (cause) => !Cause.hasInterruptsOnly(cause),
              (cause) => Effect.fail(Cause.squash(cause)),
            ),
            Effect.retry(
              SessionRetry.policy({
                provider: input.model.providerID,
                parse,
                // kilocode_change start
                ...KiloSessionProcessor.retryOpts({ sessionID: ctx.sessionID, abort: ac.signal, set: status.set }),
                // kilocode_change end
                set: (info) => {
                  // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
                  const event = flags.experimentalEventSystem
                    ? events.publish(SessionEvent.Retried, {
                        sessionID: ctx.sessionID,
                        attempt: info.attempt,
                        error: {
                          message: info.message,
                          isRetryable: true,
                        },
                        timestamp: DateTime.makeUnsafe(Date.now()),
                      })
                    : Effect.void
                  return event.pipe(
                    Effect.andThen(
                      status.set(ctx.sessionID, {
                        type: "retry",
                        attempt: info.attempt,
                        message: info.message,
                        action: info.action,
                        next: info.next,
                      }),
                    ),
                  )
                },
              }),
            ),
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )

          if (ctx.needsCompaction) return "compact"
          if (ctx.blocked || ctx.assistantMessage.error) return "stop"
          return "continue"
        })
      })

      return {
        get message() {
          return ctx.assistantMessage
        },
        updateToolCall,
        metadata, // kilocode_change
        completeToolCall,
        ...output, // kilocode_change
        process,
      } satisfies Handle
    })

    return Service.of({ create })
  }),
)

export const defaultLayer = Layer.suspend(() =>
  layer.pipe(
    Layer.provide(Session.defaultLayer),
    Layer.provide(Snapshot.defaultLayer),
    Layer.provide(Agent.defaultLayer),
    Layer.provide(LLM.defaultLayer),
    Layer.provide(Permission.defaultLayer),
    Layer.provide(Plugin.defaultLayer),
    Layer.provide(SessionSummary.defaultLayer),
    Layer.provide(SessionStatus.defaultLayer),
    Layer.provide(Image.defaultLayer),
    Layer.provide(Bus.layer),
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
  ),
)

export * as SessionProcessor from "./processor"
