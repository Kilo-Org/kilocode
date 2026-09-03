import { expect } from "bun:test"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import type { LanguageModelV3, LanguageModelV3StreamPart } from "@ai-sdk/provider"
import { jsonSchema, streamText, tool, wrapLanguageModel } from "ai"
import { Effect, Fiber } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Activity } from "@/kilocode/session/activity"
import { ActivityLLM } from "@/kilocode/session/activity-llm"
import { Question } from "@/question"
import { MessageID, SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { pollWithTimeout, testEffect } from "../../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([SessionStatus.node, Question.node])))
const info = (status: SessionStatus.Interface, id: SessionID) =>
  Effect.map(SessionStatus.snapshot(status), (items) => items.get(id) ?? { type: "idle" as const })

function model(stream: ReadableStream<LanguageModelV3StreamPart>): LanguageModelV3 {
  return {
    specificationVersion: "v3",
    provider: "activity-test",
    modelId: "activity-test",
    supportedUrls: {},
    async doGenerate() {
      throw new Error("Unexpected generate")
    },
    async doStream() {
      return { stream }
    },
  }
}

for (const parallel of [false, true]) {
  it.instance(
    `observes raw provider completion while blocked tools remain, parallel=${parallel}`,
    () =>
      Effect.gen(function* () {
        const status = yield* SessionStatus.Service
        const questions = yield* Question.Service
        const id = SessionID.make(`ses_stream_${parallel}`)
        const message = MessageID.ascending()
        const ready = Promise.withResolvers<ReadableStreamDefaultController<LanguageModelV3StreamPart>>()
        const ordinary = Promise.withResolvers<string>()
        const abort = new AbortController()
        const stream = new ReadableStream<LanguageModelV3StreamPart>({
          start(controller) {
            ready.resolve(controller)
          },
        })
        const controller = yield* Effect.promise(() => ready.promise)
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            ordinary.resolve("done")
            abort.abort()
            for (const item of yield* questions.list()) yield* questions.reject(item.id).pipe(Effect.ignore)
          }),
        )
        yield* status.set(id, { type: "busy" })
        yield* Activity.run(
          id,
          Activity.request(
            message,
            Effect.gen(function* () {
              const request = yield* Activity.Pending
              const bridge = yield* EffectBridge.make()
              const seen: string[] = []
              const tools = ActivityLLM.tools(request, {
                blocked: tool({
                  inputSchema: jsonSchema({ type: "object", properties: {} }),
                  execute: (_input, options) =>
                    bridge.promise(
                      questions.ask({
                        sessionID: id,
                        tool: { messageID: message, callID: options.toolCallId },
                        questions: [
                          {
                            header: "Continue",
                            question: "Continue?",
                            options: [{ label: "Yes", description: "Continue" }],
                          },
                        ],
                      }),
                    ),
                }),
                ordinary: tool({
                  inputSchema: jsonSchema({ type: "object", properties: {} }),
                  execute: () => ordinary.promise,
                }),
              })
              const result = streamText({
                model: wrapLanguageModel({ model: model(stream), middleware: ActivityLLM.middleware(request) }),
                tools,
                messages: [{ role: "user", content: "Run tools" }],
                abortSignal: abort.signal,
              })
              const fiber = yield* Effect.promise(async () => {
                for await (const event of result.fullStream) seen.push(event.type)
              }).pipe(Effect.forkChild)
              controller.enqueue({ type: "stream-start", warnings: [] })
              controller.enqueue({ type: "tool-call", toolCallId: "blocked", toolName: "blocked", input: "{}" })
              if (parallel)
                controller.enqueue({ type: "tool-call", toolCallId: "ordinary", toolName: "ordinary", input: "{}" })
              const pending = yield* pollWithTimeout(
                Effect.map(questions.list(), (items) => items.at(0)),
                "Tool did not ask",
              )
              expect((yield* info(status, id)).working).toBe(true)
              controller.enqueue({ type: "text-start", id: "text" })
              controller.enqueue({ type: "text-delta", id: "text", delta: "Provider still progresses" })
              controller.enqueue({ type: "text-end", id: "text" })
              controller.enqueue({
                type: "finish",
                finishReason: { unified: "tool-calls", raw: "tool_calls" },
                usage: {
                  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 1, text: 1, reasoning: 0 },
                },
              })
              controller.close()
              yield* pollWithTimeout(
                Effect.sync(() => (request?.closed ? true : undefined)),
                "Raw stream did not close",
              )
              if (parallel) expect((yield* info(status, id)).working).toBe(true)
              ordinary.resolve("done")
              yield* pollWithTimeout(
                Effect.map(info(status, id), (info) => (info.working === false ? true : undefined)),
                "Blocked call remained working",
              )
              expect(seen).toContain("text-delta")
              expect(seen).not.toContain("finish-step")
              yield* questions.reply({ requestID: pending.id, answers: [["Yes"]] })
              yield* Fiber.join(fiber)
              expect(seen).toContain("finish-step")
              expect((yield* info(status, id)).working).toBe(true)
            }),
          ),
        )
        yield* status.set(id, { type: "idle" })
      }),
    15_000,
  )
}
