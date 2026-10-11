import { describe, expect, test } from "bun:test"
import { Effect, Layer, Stream, Schema } from "effect"
import { AppLayer } from "../../src/effect/app-runtime"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { KiloContextUsage } from "../../src/kilocode/session/context-usage"
import { KiloSessionOverflow } from "../../src/kilocode/session/overflow"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { Provider } from "../../src/provider/provider"
import { Agent } from "../../src/agent/agent"
import { LLM } from "../../src/session/llm"
import { jsonSchema, tool } from "ai"

const it = testEffect(Layer.mergeAll(AppLayer, TestLLMServer.layer, AppNodeBuilder.build(CrossSpawnSpawner.node)))
const model = { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("test-model") }
const config = (url: string) => ({
  model: "test/test-model",
  small_model: "test/test-model",
  snapshot: false,
  enabled_providers: ["test"],
  plugin: [],
  provider: {
    test: {
      npm: "@ai-sdk/openai-compatible",
      name: "Test",
      options: { baseURL: url },
      models: {
        "test-model": {
          name: "Test",
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 0, output: 0 },
        },
      },
    },
  },
})
const overflow = { error: { message: "maximum context length exceeded", type: "context_length_exceeded" } }

describe("context usage after compaction", () => {
  for (const chunks of [false, true]) {
    it.live(
      `persists an estimate after ${chunks ? "chunk-path" : "single-pass"} compaction and then reports real usage`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const session = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const compaction = yield* SessionCompaction.Service
            const chat = yield* session.create({ title: "Context estimate" })
            yield* llm.text("Initial response", { usage: { input: 80_000, output: 100 } })
            const initial = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "A synthetic discussion. ".repeat(200) }],
            })
            expect(initial.info.role).toBe("assistant")
            if (initial.info.role !== "assistant") return
            expect(initial.info.tokens.input).toBe(80_000)
            const overhead = KiloContextUsage.overhead(chat.id)
            expect(overhead).toBeGreaterThan(0)
            if (overhead === undefined) throw new Error("Missing overhead")

            if (chunks) yield* llm.error(400, overflow)
            yield* llm.text("Preserved the discussion and next actions.")
            if (chunks) yield* llm.text("Condensed discussion and next actions.")
            yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto: false })
            yield* prompt.loop({ sessionID: chat.id })
            const history = yield* session.messages({ sessionID: chat.id })
            const summary = history.find((msg) => msg.info.role === "assistant" && msg.info.summary)
            expect(summary?.info.role).toBe("assistant")
            if (!summary || summary.info.role !== "assistant") return
            expect(summary.info.finish).toBe("stop")
            expect(summary.info.error).toBeUndefined()
            expect(summary.info.time.completed).toBeNumber()
            const estimate = summary.info.context
            expect(estimate).toBeNumber()
            expect(estimate).toBeGreaterThan(0)
            expect(estimate).toBeLessThan(80_000)
            expect(Schema.decodeUnknownSync(MessageV2.Assistant)(summary.info).context).toBe(estimate)
            for (const context of [-1, 0.5, NaN, Infinity]) {
              expect(() => Schema.decodeUnknownSync(MessageV2.Assistant)({ ...summary.info, context })).toThrow()
            }
            expect(KiloContextUsage.overhead(chat.id)).toBe(overhead)
            const mdl = yield* (yield* Provider.Service).getModel(model.providerID, model.modelID)
            const filtered = yield* MessageV2.filterCompactedEffect(chat.id)
            const messages = yield* MessageV2.toModelMessagesEffect(
              KiloSessionPrompt.maybeStripHistoricalMedia(KiloSessionPrompt.trimBeforeLastSummary(filtered)),
              mdl,
            )
            expect(estimate).toBe(overhead + KiloSessionOverflow.measure({ messages, tools: {} }).normalized)
            expect(history.filter((msg) => msg.info.role === "assistant" && msg.info.summary)).toHaveLength(1)

            yield* llm.text("Continue", { usage: { input: 16_000, output: 20 } })
            const next = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "Continue briefly." }],
            })
            expect(next.info.role).toBe("assistant")
            if (next.info.role !== "assistant") return
            expect(next.info.tokens.input).toBe(16_000)
            expect(next.info.context).toBeUndefined()
          }),
          { config },
        ),
      60_000,
    )
  }

  it.live(
    "does not estimate after a failed compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const session = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const compaction = yield* SessionCompaction.Service
          const chat = yield* session.create({ title: "Failed compaction" })
          yield* llm.text("Initial response")
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model,
            parts: [{ type: "text", text: "Discuss." }],
          })
          yield* llm.error(400, { error: { message: "Invalid request", type: "invalid_request_error" } })
          yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto: false })
          yield* prompt.loop({ sessionID: chat.id })
          const summary = (yield* session.messages({ sessionID: chat.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
          expect(summary.info.error).toBeDefined()
          expect(summary.info.context).toBeUndefined()
        }),
        { config },
      ),
    60_000,
  )

  it.live(
    "does not estimate without a recorded normal request",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const session = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const compaction = yield* SessionCompaction.Service
          const chat = yield* session.create({ title: "No overhead" })
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model,
            noReply: true,
            parts: [{ type: "text", text: "Discuss." }],
          })
          yield* llm.text("Preserved discussion.")
          yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto: false })
          yield* prompt.loop({ sessionID: chat.id })
          const summary = (yield* session.messages({ sessionID: chat.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
          expect(summary.info.finish).toBe("stop")
          expect(summary.info.error).toBeUndefined()
          expect(summary.info.context).toBeUndefined()
        }),
        { config },
      ),
    60_000,
  )

  test("only measured normal steps update overhead, with bounded oldest-entry eviction", () => {
    const id = `context-${crypto.randomUUID()}`
    KiloContextUsage.record(id, true, { overhead: 100 })
    KiloContextUsage.record(id, false, { overhead: 900 })
    KiloContextUsage.record(id, undefined, { overhead: 800 })
    KiloContextUsage.record(id, true, undefined)
    expect(KiloContextUsage.overhead(id)).toBe(100)
    for (let i = 0; i < 512; i++) KiloContextUsage.record(`${id}-${i}`, true, { overhead: i })
    expect(KiloContextUsage.overhead(id)).toBeUndefined()
    expect(KiloContextUsage.overhead(`${id}-511`)).toBe(511)
    KiloContextUsage.record(`${id}-0`, true, { overhead: 42 })
    KiloContextUsage.record(`${id}-512`, true, { overhead: 512 })
    expect(KiloContextUsage.overhead(`${id}-0`)).toBe(42)
    expect(KiloContextUsage.overhead(`${id}-1`)).toBeUndefined()
  })

  it.live(
    "records normal overhead before preflight rejects the outgoing request",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const session = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const chat = yield* session.create({ title: "Preflight overhead" })
          const user = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model,
            noReply: true,
            parts: [{ type: "text", text: "Discuss." }],
          })
          if (user.info.role !== "user") throw new Error("Missing user")
          const agent = yield* (yield* Agent.Service).get("code")
          if (!agent) throw new Error("Missing code agent")
          const mdl = yield* (yield* Provider.Service).getModel(model.providerID, model.modelID)
          const result = yield* (yield* LLM.Service)
            .stream({
              user: user.info,
              sessionID: chat.id,
              model: mdl,
              agent,
              preflight: true,
              system: ["Synthetic system instructions"],
              messages: [{ role: "user", content: "large history ".repeat(50_000) }],
              tools: { inspect: tool({ description: "Inspect a task", inputSchema: jsonSchema({ type: "object" }) }) },
            })
            .pipe(Stream.runDrain, Effect.result)
          expect(result._tag).toBe("Failure")
          if (result._tag !== "Failure") throw new Error("Expected preflight failure")
          expect(result.failure).toBeInstanceOf(KiloSessionOverflow.PreflightError)
          expect(KiloContextUsage.overhead(chat.id)).toBeGreaterThan(0)
          expect(yield* llm.calls).toBe(0)
        }),
        { config: (url) => ({ ...config(url), compaction: { auto: true, threshold_percent: 50 } }) },
      ),
    60_000,
  )
})
