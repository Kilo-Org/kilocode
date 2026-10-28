import { describe, expect, test, spyOn } from "bun:test"
import { Effect, Layer, Stream, Schema, Logger } from "effect"
import { AppLayer } from "../../src/effect/app-runtime"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionCompaction } from "../../src/session/compaction"
import { MessageV2 } from "../../src/session/message-v2"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { provideTmpdirServer, reloadInstance, provideInstanceEffect } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { KiloContextUsage } from "../../src/kilocode/session/context-usage"
import { KiloSessionOverflow } from "../../src/kilocode/session/overflow"
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
        "test-model-2": {
          name: "Test 2",
          limit: { context: 128_000, output: 16_000 },
          cost: { input: 0, output: 0 },
        },
      },
    },
  },
})
const overflow = { error: { message: "maximum context length exceeded", type: "context_length_exceeded" } }
const binding = { agent: "code", ...model }

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
            expect(initial.info.contextOverhead).toBe(overhead)
            for (const value of [-1, 0.5, NaN, Infinity]) {
              expect(() =>
                Schema.decodeUnknownSync(MessageV2.Assistant)({ ...initial.info, contextOverhead: value }),
              ).toThrow()
            }
            const legacy = { ...initial.info, contextOverhead: undefined }
            expect(Schema.encodeSync(MessageV2.Assistant)(legacy)).not.toHaveProperty("contextOverhead")

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
            const estimate = summary.info.estimate
            expect(estimate).toBeNumber()
            expect(overhead).toBeGreaterThan(0)
            if (overhead === undefined) throw new Error("Missing overhead")
            expect(estimate).toBeGreaterThan(0)
            expect(estimate).toBeLessThan(80_000)
            expect(Schema.decodeUnknownSync(MessageV2.Assistant)(summary.info).estimate).toBe(estimate)
            for (const estimate of [-1, 0.5, NaN, Infinity]) {
              expect(() => Schema.decodeUnknownSync(MessageV2.Assistant)({ ...summary.info, estimate })).toThrow()
            }
            expect(KiloContextUsage.overhead(chat.id)).toBe(overhead)
            expect(estimate).toBeGreaterThan(overhead)
            expect(estimate).toBeLessThan(overhead + 1_000)
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
            expect(next.info.estimate).toBeUndefined()
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
          expect(summary.info.estimate).toBeUndefined()
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
          expect(summary.info.estimate).toBeUndefined()
        }),
        { config },
      ),
    60_000,
  )

  test("only measured normal steps update overhead, with bounded oldest-entry eviction", () => {
    const id = `context-${crypto.randomUUID()}`
    const saved: number[] = []
    const persist = (value: number) => saved.push(value)
    KiloContextUsage.record(id, true, { overhead: 100 }, binding, persist)
    KiloContextUsage.record(id, false, { overhead: 900 }, { ...binding, agent: "compaction" }, persist)
    KiloContextUsage.record(id, undefined, { overhead: 800 }, binding)
    KiloContextUsage.record(id, true, undefined, binding)
    expect(KiloContextUsage.overhead(id)).toBe(100)
    expect(saved).toEqual([100])
    for (let i = 0; i < 512; i++) KiloContextUsage.record(`${id}-${i}`, true, { overhead: i }, binding)
    expect(KiloContextUsage.overhead(id)).toBeUndefined()
    expect(KiloContextUsage.overhead(`${id}-511`)).toBe(511)
    KiloContextUsage.record(`${id}-0`, true, { overhead: 42 }, binding)
    KiloContextUsage.record(`${id}-512`, true, { overhead: 512 }, binding)
    expect(KiloContextUsage.overhead(`${id}-0`)).toBe(42)
    expect(KiloContextUsage.overhead(`${id}-1`)).toBeUndefined()
  })

  for (const next of [
    { kind: "agent", agent: "plan", model },
    { kind: "provider", agent: "code", model: { ...model, providerID: ProviderV2.ID.make("test2") } },
    { kind: "model", agent: "code", model: { ...model, modelID: ModelV2.ID.make("test-model-2") } },
  ]) {
    it.live(
      `estimates from stored overhead when the next ${next.kind} changes`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const session = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const compaction = yield* SessionCompaction.Service
            const chat = yield* session.create({ title: "Binding mismatch" })
            yield* llm.text("Initial response")
            yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "Discuss." }],
            })
            const overhead = KiloContextUsage.overhead(chat.id)
            if (overhead === undefined) throw new Error("Missing overhead")
            yield* llm.text("Preserved discussion.")
            yield* compaction.create({ sessionID: chat.id, agent: next.agent, model: next.model, auto: false })
            yield* prompt.loop({ sessionID: chat.id })
            const summary = (yield* session.messages({ sessionID: chat.id })).find(
              (msg) => msg.info.role === "assistant" && msg.info.summary,
            )
            if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
            expect(summary.info.finish).toBe("stop")
            expect(summary.info.error).toBeUndefined()
            expect(KiloContextUsage.overhead(chat.id)).toBe(overhead)
            expect(summary.info.estimate).toBeGreaterThan(overhead)
          }),
          {
            config: (url) => {
              const cfg = config(url)
              const provider = {
                ...cfg.provider.test,
                models: { ...cfg.provider.test.models, "test-model-2": cfg.provider.test.models["test-model"] },
              }
              return { ...cfg, enabled_providers: ["test", "test2"], provider: { test: provider, test2: provider } }
            },
          },
        ),
      180_000,
    )
  }

  for (const auto of [false, true]) {
    it.live(
      `a failing estimate leaves ${auto ? "automatic continuation" : "manual compaction"} successful`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const session = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const compaction = yield* SessionCompaction.Service
            const chat = yield* session.create({ title: "Estimate failure isolation" })
            yield* llm.text("Initial response")
            yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "Discuss." }],
            })
            const logs: unknown[] = []
            const logger = Logger.make((options) => logs.push(options.message))
            const failure = spyOn(KiloContextUsage, "compacted").mockImplementation(() =>
              Effect.die(new Error("Synthetic estimate failure")),
            )
            yield* Effect.addFinalizer(() => Effect.sync(() => failure.mockRestore()))
            yield* llm.text("Preserved discussion.")
            if (auto) yield* llm.text("Continued successfully", { usage: { input: 1_000, output: 20 } })
            yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto })
            const result = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.provide(Logger.layer([logger])))
            const summary = (yield* session.messages({ sessionID: chat.id })).find(
              (msg) => msg.info.role === "assistant" && msg.info.summary,
            )
            if (!summary || summary.info.role !== "assistant" || result.info.role !== "assistant")
              throw new Error("Missing response")
            expect(summary.info.finish).toBe("stop")
            expect(summary.info.error).toBeUndefined()
            expect(summary.info.estimate).toBeUndefined()
            expect(result.info.error).toBeUndefined()
            expect(JSON.stringify(logs)).toContain("context estimate failed")
            expect(JSON.stringify(logs)).toContain(chat.id)
            if (auto) expect(result.info.tokens.input).toBe(1_000)
          }),
          { config },
        ),
      180_000,
    )
  }

  it.live(
    "preflight auto-compaction estimates the replay message as well as the summary",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const session = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const chat = yield* session.create({ title: "Replay estimate" })
          yield* llm.text("Initial response", { usage: { input: 110_000, output: 100 } })
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model,
            parts: [{ type: "text", text: "Discuss." }],
          })
          const text = "Replay input remains relevant after the summary. ".repeat(300)
          yield* llm.text("Preserved the initial discussion.")
          yield* llm.text("Replay accepted", { usage: { input: 16_000, output: 20 } })
          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model,
            parts: [{ type: "text", text }],
          })
          const history = yield* session.messages({ sessionID: chat.id })
          const summary = history.find((msg) => msg.info.role === "assistant" && msg.info.summary)
          if (!summary || summary.info.role !== "assistant" || result.info.role !== "assistant")
            throw new Error("Missing response")
          const replay = history.find(
            (msg) =>
              msg.info.role === "user" &&
              msg.parts.some((part) => part.type === "text" && part.synthetic && part.text === text),
          )
          expect(replay).toBeDefined()
          if (!replay) throw new Error("Missing replay")
          expect(history.some((msg) => msg.parts.some((part) => part.type === "compaction" && part.auto))).toBe(true)
          expect(summary.info.estimate).toBeGreaterThan(5_000)
          const overhead = KiloContextUsage.overhead(chat.id)
          if (overhead === undefined) throw new Error("Missing overhead")
          expect(summary.info.estimate).toBeGreaterThan(overhead + 3_000)
          expect(result.info.parentID).toBe(replay.info.id)
          expect(result.info.tokens.input).toBe(16_000)
          expect(result.info.error).toBeUndefined()
          expect(yield* llm.calls).toBe(3)
        }),
        { config: (url) => ({ ...config(url), compaction: { auto: true, threshold_percent: 95 } }) },
      ),
    180_000,
  )

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

  it.live(
    "models without an output cap record overhead and estimate after compaction",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const session = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
          const compaction = yield* SessionCompaction.Service
          const chat = yield* session.create({ title: "No output cap" })
          const uncapped = { ...model, modelID: ModelV2.ID.make("gpt-5-test") }
          yield* llm.text("Initial response")
          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model: uncapped,
            parts: [{ type: "text", text: "Discuss." }],
          })
          expect(KiloContextUsage.overhead(chat.id)).toBeGreaterThan(0)
          yield* llm.text("Preserved discussion.")
          yield* compaction.create({ sessionID: chat.id, agent: "code", model: uncapped, auto: false })
          yield* prompt.loop({ sessionID: chat.id })
          const summary = (yield* session.messages({ sessionID: chat.id })).find(
            (msg) => msg.info.role === "assistant" && msg.info.summary,
          )
          if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
          expect(summary.info.finish).toBe("stop")
          expect(summary.info.error).toBeUndefined()
          expect(summary.info.estimate).toBeGreaterThan(0)
        }),
        {
          config: (url) => {
            const cfg = config(url)
            return {
              ...cfg,
              compaction: { auto: true, threshold_percent: 95 },
              provider: {
                test: {
                  ...cfg.provider.test,
                  models: { ...cfg.provider.test.models, "gpt-5-test": cfg.provider.test.models["test-model"] },
                },
              },
            }
          },
        },
      ),
    180_000,
  )

  for (const fresh of [false, true]) {
    it.live(
      `recovers stored overhead after ${fresh ? "instance reload" : "record eviction"}`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ dir, llm }) {
            const session = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const chat = yield* session.create({ title: "Stored overhead" })
            yield* llm.text("Initial response", { usage: { input: 80_000, output: 100 } })
            const response = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "A synthetic discussion. ".repeat(200) }],
            })
            if (response.info.role !== "assistant") throw new Error("Missing response")
            const overhead = KiloContextUsage.overhead(chat.id)
            expect(overhead).toBeGreaterThan(0)
            const persisted = yield* MessageV2.get({ sessionID: chat.id, messageID: response.info.id })
            expect(Reflect.get(persisted.info, "contextOverhead")).toBe(overhead)
            for (let i = 0; i < 512; i++) KiloContextUsage.record(`${chat.id}-${i}`, true, { overhead: i }, binding)
            expect(KiloContextUsage.overhead(chat.id)).toBeUndefined()
            if (fresh) yield* reloadInstance({ directory: dir })
            yield* Effect.gen(function* () {
              const compaction = yield* SessionCompaction.Service
              const prompt = yield* SessionPrompt.Service
              const session = yield* Session.Service
              yield* llm.text("Preserved the discussion and next actions.")
              yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto: false })
              yield* prompt.loop({ sessionID: chat.id })
              const summary = (yield* session.messages({ sessionID: chat.id })).find(
                (msg) => msg.info.role === "assistant" && msg.info.summary,
              )
              if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
              expect(summary.info.finish).toBe("stop")
              expect(summary.info.error).toBeUndefined()
              expect(summary.info.estimate).toBeGreaterThan(overhead!)
              expect(summary.info.estimate).toBeLessThan(overhead! + 1_000)
              yield* llm.text("Continue", { usage: { input: 16_000, output: 20 } })
              const next = yield* prompt.prompt({
                sessionID: chat.id,
                agent: "code",
                model,
                parts: [{ type: "text", text: "Continue briefly." }],
              })
              if (next.info.role !== "assistant") throw new Error("Missing response")
              expect(next.info.tokens.input).toBe(16_000)
              expect(next.info.estimate).toBeUndefined()
            }).pipe(provideInstanceEffect(dir))
          }),
          { config },
        ),
      180_000,
    )
  }

  for (const match of ["exact binding", "same agent"])
    it.live(
      `prefers an older ${match} over a newer cross-binding record`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const session = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
            const compaction = yield* SessionCompaction.Service
            const chat = yield* session.create({ title: "Exact binding" })
            yield* llm.text("Code response")
            const code = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model,
              parts: [{ type: "text", text: "Discuss." }],
            })
            if (code.info.role !== "assistant") throw new Error("Missing code response")
            const overhead = KiloContextUsage.overhead(chat.id)
            if (overhead === undefined) throw new Error("Missing overhead")
            yield* llm.text("Plan response")
            const plan = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "plan",
              model,
              parts: [{ type: "text", text: "Plan briefly." }],
            })
            if (plan.info.role !== "assistant") throw new Error("Missing plan response")
            yield* session.updateMessage({ ...plan.info, contextOverhead: 90_000 })
            yield* llm.text("Preserved discussion.")
            yield* compaction.create({
              sessionID: chat.id,
              agent: "code",
              model: match === "exact binding" ? model : { ...model, modelID: ModelV2.ID.make("test-model-2") },
              auto: false,
            })
            yield* prompt.loop({ sessionID: chat.id })
            const summary = (yield* session.messages({ sessionID: chat.id })).find(
              (msg) => msg.info.role === "assistant" && msg.info.summary,
            )
            if (!summary || summary.info.role !== "assistant") throw new Error("Missing summary")
            expect(summary.info.estimate).toBeGreaterThan(overhead)
            expect(summary.info.estimate).toBeLessThan(overhead + 1_000)
          }),
          { config },
        ),
      180_000,
    )
})
