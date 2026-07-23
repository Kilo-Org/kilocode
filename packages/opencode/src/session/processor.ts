import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { Image } from "@/image/image"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Cause, Deferred, Effect, Exit, Layer, Context, Scope, Schema } from "effect"
import * as Stream from "effect/Stream"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Snapshot } from "@/snapshot"
import { Session } from "./session"
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
import { isRecord } from "@/util/record"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import * as DateTime from "effect/DateTime"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { ToolOutput, Usage, type LLMEvent } from "@opencode-ai/llm"

const DOOM_LOOP_THRESHOLD = 3
export type Result = "compact" | "stop" | "continue"

export interface Handle {
  readonly message: SessionV1.Assistant
  readonly updateToolCall: (
    toolCallID: string,
    update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
  ) => Effect.Effect<SessionV1.ToolPart | undefined>
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
      attachments?: SessionV1.FilePart[]
    },
  ) => Effect.Effect<void>
  readonly process: (streamInput: LLM.StreamInput) => Effect.Effect<Result>
  readonly compactError?: () => ReturnType<typeof MessageV2.ContextOverflowError.prototype.toObject> | undefined // kilocode_change
}

type Input = {
  assistantMessage: SessionV1.Assistant
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
  assistantMessageID?: SessionMessage.ID
  partID: SessionV1.ToolPart["id"]
  messageID: SessionV1.ToolPart["messageID"]
  sessionID: SessionV1.ToolPart["sessionID"]
  done: Deferred.Deferred<void>
  inputEnded: boolean
  raw: string
}

interface ProcessorContext extends Input {
  toolcalls: Record<string, ToolCall>
  toolmeta: Record<string, { title?: string; metadata?: Record<string, any> }> // kilocode_change
  shouldBreak: boolean
  snapshot: string | undefined
  blocked: boolean
  needsCompaction: boolean
  compactionError: ReturnType<typeof MessageV2.ContextOverflowError.prototype.toObject> | undefined // kilocode_change
  currentText: SessionV1.TextPart | undefined
  currentTextID: string | undefined
  reasoningMap: Record<string, SessionV1.ReasoningPart>
  // kilocode_change start
  stepStart: number
  stepStartDate: number | undefined
  step: { reasoning: boolean; text: boolean; tool: boolean }
  // kilocode_change end
  v2AssistantMessageID: SessionMessage.ID | undefined
}

type StreamEvent = LLMEvent

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionProcessor") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const session = yield* Session.Service
    const config = yield* Config.Service
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
    const database = yield* Database.Service

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
        currentTextID: undefined,
        reasoningMap: {},
        // kilocode_change start
        telemetry: input.telemetry,
        stepStart: 0,
        stepStartDate: undefined,
        step: { reasoning: false, text: false, tool: false },
        // kilocode_change end
        v2AssistantMessageID: undefined,
      }
      const mirrorAssistant = flags.experimentalEventSystem && !input.assistantMessage.summary
      let aborted = false
      const ac = new AbortController() // kilocode_change — abort controller for offline handler
      let attempt = KiloSessionProcessor.attempt() // kilocode_change

      // kilocode_change start
      const parse = (e: unknown) =>
        KiloSessionProcessor.parseError(e, {
          providerID: input.model.providerID,
          aborted,
        })
      const retryParse = (e: unknown) => {
        const error = parse(e)
        if (e instanceof KiloSessionProcessor.IncompleteResponseError) return KiloSessionProcessor.blockRetry(error)
        if (attempt.text || attempt.reasoning || attempt.tool) return KiloSessionProcessor.blockRetry(error)
        return error
      }
      // kilocode_change end

      const settleToolCall = Effect.fn("SessionProcessor.settleToolCall")(function* (toolCallID: string) {
        const done = ctx.toolcalls[toolCallID]?.done
        delete ctx.toolcalls[toolCallID]
        delete ctx.toolmeta[toolCallID] // kilocode_change
        if (done) yield* Deferred.succeed(done, undefined).pipe(Effect.ignore)
      })

      const ensureV2AssistantMessage = Effect.fn("SessionProcessor.ensureV2AssistantMessage")(function* () {
        if (ctx.v2AssistantMessageID) return ctx.v2AssistantMessageID
        ctx.v2AssistantMessageID = SessionMessage.ID.create()
        yield* events.publish(SessionEvent.Step.Started, {
          sessionID: ctx.sessionID,
          assistantMessageID: ctx.v2AssistantMessageID,
          agent: input.assistantMessage.agent,
          model: {
            id: ModelV2.ID.make(ctx.model.id),
            providerID: ProviderV2.ID.make(ctx.model.providerID),
            variant: ModelV2.VariantID.make(input.assistantMessage.variant ?? "default"),
          },
          snapshot: ctx.snapshot,
          timestamp: DateTime.makeUnsafe(Date.now()),
        })
        return ctx.v2AssistantMessageID
      })

      const requireV2AssistantMessage = (toolCall?: ToolCall) =>
        toolCall?.assistantMessageID === undefined
          ? Effect.die("V2 tool settlement has no owning assistant message")
          : Effect.succeed(toolCall.assistantMessageID)

      const currentV2AssistantMessage = () =>
        ctx.v2AssistantMessageID === undefined
          ? Effect.die("V2 step settlement has no owning assistant message")
          : Effect.succeed(ctx.v2AssistantMessageID)

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
        }).pipe(
          Effect.provideService(Database.Service, database),
          Effect.catchTag("NotFoundError", () => Effect.void),
        )
        if (fresh?.info.role !== "assistant") return
        if (fresh.info.cost <= ctx.assistantMessage.cost) return
        ctx.assistantMessage.cost = fresh.info.cost
      })
      // kilocode_change end

      const updateToolCall = Effect.fn("SessionProcessor.updateToolCall")(function* (
        toolCallID: string,
        update: (part: SessionV1.ToolPart) => SessionV1.ToolPart,
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
          attachments?: SessionV1.FilePart[]
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
          error instanceof PermissionV1.RejectedError ||
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
        if (mirrorAssistant) {
          yield* events.publish(SessionEvent.Reasoning.Ended, {
            sessionID: ctx.sessionID,
            assistantMessageID: yield* currentV2AssistantMessage(),
            reasoningID,
            text: ctx.reasoningMap[reasoningID].text,
            providerMetadata: ctx.reasoningMap[reasoningID].metadata,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        // oxlint-disable-next-line no-self-assign -- reactivity trigger
        ctx.reasoningMap[reasoningID].text = ctx.reasoningMap[reasoningID].text
        ctx.reasoningMap[reasoningID].time = { ...ctx.reasoningMap[reasoningID].time, end: Date.now() }
        yield* session.updatePart(ctx.reasoningMap[reasoningID])
        delete ctx.reasoningMap[reasoningID]
      })

      const flushV2Fragments = Effect.fn("SessionProcessor.flushV2Fragments")(function* () {
        if (!mirrorAssistant) return
        if (!ctx.assistantMessage.summary && ctx.currentText && ctx.currentTextID) {
          yield* events.publish(SessionEvent.Text.Ended, {
            sessionID: ctx.sessionID,
            assistantMessageID: yield* currentV2AssistantMessage(),
            textID: ctx.currentTextID,
            text: ctx.currentText.text,
            timestamp: DateTime.makeUnsafe(Date.now()),
          })
        }
        yield* Effect.forEach(Object.entries(ctx.reasoningMap), ([reasoningID, part]) =>
          currentV2AssistantMessage().pipe(
            Effect.flatMap((assistantMessageID) =>
              events.publish(SessionEvent.Reasoning.Ended, {
                sessionID: ctx.sessionID,
                assistantMessageID,
                reasoningID,
                text: part.text,
                providerMetadata: part.metadata,
                timestamp: DateTime.makeUnsafe(Date.now()),
              }),
            ),
          ),
        )
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
        const assistantMessageID = mirrorAssistant ? yield* ensureV2AssistantMessage() : undefined
        if (assistantMessageID) {
          yield* events.publish(SessionEvent.Tool.Input.Started, {
            sessionID: ctx.sessionID,
            assistantMessageID,
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
        } satisfies SessionV1.ToolPart)
        ctx.toolcalls[input.id] = {
          assistantMessageID,
          done: yield* Deferred.make<void>(),
          partID: part.id,
          messageID: part.messageID,
          sessionID: part.sessionID,
          inputEnded: false,
          raw: "",
        }
        return { call: ctx.toolcalls[input.id], part }
      })

      const isFilePart = (value: unknown): value is SessionV1.FilePart => Schema.is(SessionV1.FilePart)(value)

      const toolResultOutput = (
        value: Extract<StreamEvent, { type: "tool-result" }>,
      ): { title: string; metadata: Record<string, any>; output: string; attachments?: SessionV1.FilePart[] } => {
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

      const handleEvent = Effect.fnUntraced(function* (value: StreamEvent) {
        KiloSessionProcessor.observe(attempt, value) // kilocode_change
        switch (value.type) {
          case "reasoning-start":
            if (value.id in ctx.reasoningMap) return
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (mirrorAssistant) {
              yield* events.publish(SessionEvent.Reasoning.Started, {
                sessionID: ctx.sessionID,
                assistantMessageID: yield* ensureV2AssistantMessage(),
                reasoningID: value.id,
                providerMetadata: value.providerMetadata,
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
            if (value.text.trim()) ctx.step.reasoning = true // kilocode_change
            if (value.providerMetadata) ctx.reasoningMap[value.id].metadata = value.providerMetadata
            if (mirrorAssistant) {
              yield* events.publish(SessionEvent.Reasoning.Delta, {
                sessionID: ctx.sessionID,
                assistantMessageID: yield* currentV2AssistantMessage(),
                reasoningID: value.id,
                delta: value.text,
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
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
            // kilocode_change start
            ctx.step.tool = true
            // kilocode_change end
            yield* ensureToolCall(value)
            return

          // kilocode_change start
          case "tool-input-delta":
            {
              const toolCall = yield* readToolCall(value.id)
              if (!toolCall) return
              // kilocode_change end
              const assistantMessageID = mirrorAssistant ? yield* requireV2AssistantMessage(toolCall.call) : undefined
              if (assistantMessageID) {
                yield* events.publish(SessionEvent.Tool.Input.Delta, {
                  sessionID: ctx.sessionID,
                  assistantMessageID,
                  callID: value.id,
                  delta: value.text,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
              ctx.toolcalls[value.id] = { ...toolCall.call, raw: toolCall.call.raw + value.text }
            }
            return

          // kilocode_change start
          case "tool-input-end": {
            const toolCall = yield* readToolCall(value.id)
            if (!toolCall) return
            // kilocode_change end
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (mirrorAssistant) {
              const assistantMessageID = yield* requireV2AssistantMessage(toolCall.call)
              yield* events.publish(SessionEvent.Tool.Input.Ended, {
                sessionID: ctx.sessionID,
                assistantMessageID,
                callID: value.id,
                text: toolCall.call.raw,
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
            ctx.step.tool = true // kilocode_change
            const toolCall = yield* ensureToolCall(value)
            const input = isRecord(value.input) ? value.input : { value: value.input }
            if (!toolCall.call.inputEnded) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (mirrorAssistant) {
                const assistantMessageID = yield* requireV2AssistantMessage(toolCall.call)
                yield* events.publish(SessionEvent.Tool.Input.Ended, {
                  sessionID: ctx.sessionID,
                  assistantMessageID,
                  callID: value.id,
                  text: toolCall.call.raw,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
            }
            // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
            if (mirrorAssistant) {
              const assistantMessageID = yield* requireV2AssistantMessage(toolCall.call)
              yield* events.publish(SessionEvent.Tool.Called, {
                sessionID: ctx.sessionID,
                assistantMessageID,
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

            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
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
            if (!toolCall && value.result.type === "error") return
            if (value.result.type === "error") {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (mirrorAssistant) {
                const assistantMessageID = yield* requireV2AssistantMessage(toolCall?.call)
                yield* events.publish(SessionEvent.Tool.Failed, {
                  sessionID: ctx.sessionID,
                  assistantMessageID,
                  callID: value.id,
                  error: { type: "unknown", message: errorMessage(value.result.value) },
                  result: value.result,
                  provider: {
                    executed: value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true,
                    ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
                  },
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
              }
              yield* failToolCall(value.id, value.result.value)
              return
            }
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
                : Effect.succeed(Exit.succeed<SessionV1.FilePart>(attachment)),
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
            if (mirrorAssistant) {
              const assistantMessageID = yield* requireV2AssistantMessage(toolCall?.call)
              const content = [
                { type: "text" as const, text: output.output },
                ...(output.attachments?.map(
                  (item: SessionV1.FilePart) =>
                    ({
                      type: "file",
                      uri: item.url,
                      mime: item.mime,
                      name: item.filename,
                    }) as const,
                ) ?? []),
              ]
              const unsupported = content.find((item) => item.type === "file" && !item.uri.startsWith("data:"))
              if (unsupported?.type === "file") {
                const error = new Error(
                  `Tool attachment URI "${unsupported.uri}" must be materialized before durable V2 settlement`,
                )
                yield* events.publish(SessionEvent.Tool.Failed, {
                  sessionID: ctx.sessionID,
                  assistantMessageID,
                  callID: value.id,
                  error: {
                    type: "unknown",
                    message: error.message,
                  },
                  provider: {
                    executed: value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true,
                    ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
                  },
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
                yield* failToolCall(value.id, error)
                return
              } else
                yield* events.publish(SessionEvent.Tool.Success, {
                  sessionID: ctx.sessionID,
                  assistantMessageID,
                  callID: value.id,
                  structured: output.metadata,
                  content,
                  result: value.result,
                  provider: {
                    executed: value.providerExecuted === true || toolCall?.part.metadata?.providerExecuted === true,
                    ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
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
            if (mirrorAssistant) {
              const assistantMessageID = yield* requireV2AssistantMessage(toolCall?.call)
              yield* events.publish(SessionEvent.Tool.Failed, {
                sessionID: ctx.sessionID,
                assistantMessageID,
                callID: value.id,
                error: {
                  type: "unknown",
                  message: value.message,
                },
                provider: {
                  executed: toolCall?.part.metadata?.providerExecuted === true,
                  ...(value.providerMetadata ? { metadata: value.providerMetadata } : {}),
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
            ctx.stepStartDate = Date.now()
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
              if (mirrorAssistant) {
                yield* ensureV2AssistantMessage()
              }
            }
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: ctx.assistantMessage.id,
              sessionID: ctx.sessionID,
              snapshot: ctx.snapshot,
              type: "step-start",
              time: { start: ctx.stepStartDate }, // kilocode_change
            })
            return

          case "step-finish": {
            // kilocode_change start - retry only terminally incomplete attempts before settlement
            if (
              !mirrorAssistant &&
              KiloSessionProcessor.replayable({
                finish: attempt.finish,
                text: attempt.text,
                reasoning: attempt.reasoning,
                tool: attempt.tool,
                usage: attempt.usage,
              })
            )
              return yield* Effect.fail(new KiloSessionProcessor.IncompleteResponseError())
            // kilocode_change end
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
            const endDate = Date.now()
            const elapsedMs = Math.round(
              performance.now() - (ctx.stepStart || performance.now()),
            )
            const startDate = ctx.stepStartDate ?? (Number.isFinite(elapsedMs) ? endDate - elapsedMs : endDate)
            const metrics = KiloSessionProcessor.computeMetrics({
              providerMetadata: value.providerMetadata,
              tokens: usage.tokens,
              elapsedMs,
            })
            KiloSessionProcessor.trackStep({
              sessionID: ctx.sessionID,
              model: ctx.model,
              tokens: usage.tokens,
              cost: usage.cost,
              elapsed: elapsedMs,
              telemetry: ctx.telemetry,
            })
            // kilocode_change end
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (mirrorAssistant) {
                yield* events.publish(SessionEvent.Step.Ended, {
                  sessionID: ctx.sessionID,
                  assistantMessageID: yield* currentV2AssistantMessage(),
                  finish: value.reason,
                  cost: usage.cost,
                  tokens: usage.tokens,
                  snapshot: completedSnapshot,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                })
                ctx.v2AssistantMessageID = undefined
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
              time: { start: startDate, end: endDate, elapsed: elapsedMs }, // kilocode_change
              ...(model ? { model } : {}), // kilocode_change
              ...(metrics ? { metrics } : {}), // kilocode_change
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
              yield* events.publish(Session.Event.Error, {
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
              if (mirrorAssistant) {
                yield* events.publish(SessionEvent.Text.Started, {
                  sessionID: ctx.sessionID,
                  assistantMessageID: yield* ensureV2AssistantMessage(),
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  textID: value.id,
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
            ctx.currentTextID = value.id
            yield* session.updatePart(ctx.currentText)
            return

          case "text-delta":
            if (!ctx.currentText) return
            ctx.currentText.text += value.text
            if (value.text.trim()) ctx.step.text = true // kilocode_change
            if (value.providerMetadata) ctx.currentText.metadata = value.providerMetadata
            if (mirrorAssistant) {
              yield* events.publish(SessionEvent.Text.Delta, {
                sessionID: ctx.sessionID,
                assistantMessageID: yield* currentV2AssistantMessage(),
                textID: value.id,
                delta: value.text,
                timestamp: DateTime.makeUnsafe(Date.now()),
              })
            }
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
            if (ctx.currentText.text.trim()) {
              attempt.text = true // kilocode_change
              ctx.step.text = true
            } // kilocode_change
            if (!ctx.assistantMessage.summary) {
              // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
              if (mirrorAssistant) {
                yield* events.publish(SessionEvent.Text.Ended, {
                  sessionID: ctx.sessionID,
                  assistantMessageID: yield* currentV2AssistantMessage(),
                  text: ctx.currentText.text,
                  timestamp: DateTime.makeUnsafe(Date.now()),
                  textID: value.id,
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
            ctx.currentTextID = undefined
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
          ctx.currentTextID = undefined
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
          if (mirrorAssistant && match.call.assistantMessageID) {
            yield* events.publish(SessionEvent.Tool.Failed, {
              sessionID: ctx.sessionID,
              assistantMessageID: match.call.assistantMessageID,
              callID: toolCallID,
              error: { type: "unknown", message: "Tool execution aborted" },
              provider: { executed: part.metadata?.providerExecuted === true },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
          }
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
        // kilocode_change start - read parts through the upstream Effect database
        KiloSessionProcessor.guardEmptyToolCalls(
          ctx.assistantMessage,
          yield* MessageV2.parts(ctx.assistantMessage.id).pipe(Effect.provideService(Database.Service, database)),
        )
        // kilocode_change end
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
        yield* Effect.logError("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
          error: errorMessage(e),
          stack: e instanceof Error ? e.stack : undefined,
        })
        const error = parse(e)
        // kilocode_change start
        if (e instanceof KiloSessionProcessor.IncompleteResponseError) ctx.assistantMessage.finish = "unknown"
        ctx.compactionError = MessageV2.ContextOverflowError.isInstance(error) ? error : ctx.compactionError
        // kilocode_change end
        yield* flushV2Fragments()
        if (MessageV2.ContextOverflowError.isInstance(error)) {
          // respect compaction.auto === false by surfacing overflow as a hard error instead of auto-compacting
          if ((yield* config.get()).compaction?.auto === false && !ctx.assistantMessage.summary) {
            ctx.assistantMessage.error = error
            ctx.assistantMessage.finish = "error"
            yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
            yield* status.set(ctx.sessionID, { type: "idle" })
            return
          }
          ctx.needsCompaction = true
          yield* events.publish(Session.Event.Error, { sessionID: ctx.sessionID, error })
          return
        }
        if (!ctx.assistantMessage.summary) {
          // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
          if (mirrorAssistant) {
            yield* events.publish(SessionEvent.Step.Failed, {
              sessionID: ctx.sessionID,
              assistantMessageID: yield* ensureV2AssistantMessage(),
              error: {
                type: "unknown",
                message: errorMessage(e),
              },
              timestamp: DateTime.makeUnsafe(Date.now()),
            })
          }
        }
        ctx.assistantMessage.error = error
        yield* events.publish(Session.Event.Error, {
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
        yield* Effect.logInfo("process", {
          "session.id": input.sessionID,
          messageID: input.assistantMessage.id,
        })
        // kilocode_change start - a deleted session cannot accept EventV2 writes under core FK enforcement
        const exists = yield* session.get(ctx.sessionID).pipe(
          Effect.as(true),
          Effect.catchTag("NotFoundError", () => Effect.succeed(false)),
        )
        if (!exists) return "stop"
        // kilocode_change end
        ctx.needsCompaction = false
        ctx.compactionError = undefined // kilocode_change
        ctx.shouldBreak = (yield* config.get()).experimental?.continue_loop_on_deny !== true

        return yield* Effect.gen(function* () {
          // kilocode_change start - publish retry state consistently for provider and empty-response retries
          const retries = { provider: 0 }
          const setRetry = (info: {
            attempt: number
            message: string
            action?: SessionRetry.Retryable["action"]
            next: number
          }) => {
            const event = mirrorAssistant
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
            return flushV2Fragments().pipe(
              Effect.andThen(event),
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
          }

          const request = () =>
            Effect.gen(function* () {
              ctx.currentText = undefined
              ctx.currentTextID = undefined
              ctx.reasoningMap = {}
              yield* status.set(ctx.sessionID, { type: "busy" })
              ctx.step = { reasoning: false, text: false, tool: false }
              const stream = llm.stream({
                ...streamInput,
                preflight: !ctx.assistantMessage.summary,
              })

              yield* stream.pipe(
                Stream.tap((event) => handleEvent(event)),
                Stream.takeUntil(() => ctx.needsCompaction),
                Stream.runDrain,
              )
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
                  parse: retryParse,
                  ...KiloSessionProcessor.retryOpts({
                    sessionID: ctx.sessionID,
                    abort: ac.signal,
                    set: status.set,
                    used: retries.provider,
                  }),
                  set: (info) => {
                    if (info.attempt > 0) retries.provider += 1
                    return setRetry(info)
                  },
                }),
              ),
            )

          const discard = Effect.fn("SessionProcessor.discardIncomplete")(function* (baseline: Set<string>) {
            yield* Effect.forEach(
              Object.values(ctx.toolcalls),
              (call) => Deferred.succeed(call.done, undefined).pipe(Effect.ignore),
              { concurrency: "unbounded" },
            )
            const parts = yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
              Effect.provideService(Database.Service, database),
            )
            yield* Effect.forEach(
              parts.filter((part) => !baseline.has(part.id)),
              (part) =>
                session.removePart({ sessionID: ctx.sessionID, messageID: ctx.assistantMessage.id, partID: part.id }),
              { concurrency: 1 },
            )
            ctx.currentText = undefined
            ctx.currentTextID = undefined
            ctx.reasoningMap = {}
            ctx.toolcalls = {}
            ctx.toolmeta = {}
            ctx.assistantMessage.finish = undefined
          })

          const recover = () => {
            const baseline = new Set<string>()
            return KiloSessionProcessor.recover({
              run: Effect.fn("SessionProcessor.incompleteAttempt")(function* () {
                baseline.clear()
                for (const part of yield* MessageV2.parts(ctx.assistantMessage.id).pipe(
                  Effect.provideService(Database.Service, database),
                ))
                  baseline.add(part.id)
                attempt = KiloSessionProcessor.attempt()
                yield* request()
              }),
              replayable: () =>
                !mirrorAssistant &&
                KiloSessionProcessor.replayable({
                  finish: attempt.finish,
                  text: attempt.text,
                  reasoning: attempt.reasoning,
                  tool: attempt.tool,
                  usage: attempt.usage,
                }),
              discard: () => discard(baseline),
              set: setRetry,
            })
          }

          yield* recover().pipe(
            Effect.catch(halt),
            Effect.ensuring(cleanup()),
          )
          // kilocode_change end

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
    Layer.provide(Config.defaultLayer),
    Layer.provide(RuntimeFlags.defaultLayer),
    Layer.provide(Database.defaultLayer),
    Layer.provide(EventV2Bridge.defaultLayer),
  ),
)

export const node = LayerNode.make(layer, [
  Session.node,
  Config.node,
  Snapshot.node,
  Agent.node,
  LLM.node,
  Permission.node,
  Plugin.node,
  SessionSummary.node,
  SessionStatus.node,
  Image.node,
  EventV2Bridge.node,
  RuntimeFlags.node,
  Database.node,
])

export * as SessionProcessor from "./processor"
