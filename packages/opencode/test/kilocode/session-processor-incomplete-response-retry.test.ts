import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, spyOn } from "bun:test"
import { APICallError } from "ai"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, Usage, type LLMEvent as Event } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
import { KiloSessionProcessor } from "../../src/kilocode/session/processor"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Reference } from "@opencode-ai/core/reference"
import { Session } from "../../src/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionRetry } from "../../src/session/retry"
import { MessageID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import * as Log from "@opencode-ai/core/util/log"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { provideTmpdirProject } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

type Script = Stream.Stream<Event, unknown>

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly push: (stream: Script) => Effect.Effect<void>
    readonly reply: (...events: Event[]) => Effect.Effect<void>
    readonly calls: Effect.Effect<number>
  }
>()("@test/IncompleteResponseRetryLLM") {}

function model(): Provider.Model {
  return {
    id: ref.modelID,
    providerID: ref.providerID,
    name: "Test",
    limit: { context: 128000, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: true,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    options: {},
  } as Provider.Model
}

function empty() {
  const usage = new Usage({})
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.reasoningStart({ id: "reasoning" }),
    LLMEvent.reasoningEnd({ id: "reasoning" }),
    LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
    LLMEvent.finish({ reason: "unknown", usage }),
  ]
}

function success() {
  const usage = new Usage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "text" }),
    LLMEvent.textDelta({ id: "text", text: "Recovered" }),
    LLMEvent.textEnd({ id: "text" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
    LLMEvent.finish({ reason: "stop", usage }),
  ]
}

function retryable429() {
  return new APICallError({
    message: "429 status code (no body)",
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: { "content-type": "application/json" },
    isRetryable: true,
  })
}

const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = []
    let calls = 0
    const push = (stream: Script) => {
      queue.push(stream)
      return Effect.void
    }
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: () => {
            calls += 1
            return queue.shift() ?? Stream.fail(new Error("unexpected extra llm call"))
          },
        }),
      ),
      Layer.succeed(
        TestLLM,
        TestLLM.of({
          push,
          reply: (...events) => push(Stream.make(...events)),
          calls: Effect.sync(() => calls),
        }),
      ),
    )
  }),
)

const reference = Layer.mock(Reference.Service, {
  list: () => Effect.succeed([]),
})
const status = Layer.mergeAll(SessionStatus.defaultLayer, Bus.layer)
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const env = (event = false) =>
  SessionProcessor.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Session.defaultLayer,
        Snapshot.defaultLayer,
        AgentSvc.defaultLayer,
        Permission.defaultLayer,
        Plugin.defaultLayer,
        Config.defaultLayer,
        RuntimeFlags.layer({ experimentalEventSystem: event }),
        reference,
        SessionSummary.defaultLayer,
        Image.defaultLayer,
        SyncEvent.defaultLayer,
        EventV2Bridge.defaultLayer,
        Database.defaultLayer,
        status,
        llm,
      ).pipe(Layer.provideMerge(infra)),
    ),
    Layer.provide(reference),
  )

const it = testEffect(env())
const eventIt = testEffect(env(true))

const setup = Effect.fn("SessionProcessorIncompleteRetryTest.setup")(function* (dir: string) {
  const test = yield* TestLLM
  const processors = yield* SessionProcessor.Service
  const session = yield* Session.Service
  const chat = yield* session.create({})
  const parent = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "code",
    model: ref,
    time: { created: Date.now() },
  })
  const msg: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: chat.id,
    parentID: parent.id,
    mode: "code",
    agent: "code",
    path: { cwd: path.resolve(dir), root: path.resolve(dir) },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* session.updateMessage(msg)
  const mdl = model()
  const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
  const input: LLM.StreamInput = {
    user: parent as MessageV2.User,
    sessionID: chat.id,
    model: mdl,
    agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
    system: [],
    messages: [],
    tools: {},
  }
  return { test, session, msg, handle, input }
})

describe("session processor incomplete response retry", () => {
  it.effect("retries an empty unknown response and removes the failed attempt", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(...empty())
          yield* ctx.test.reply(...success())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          } finally {
            delay.mockRestore()
          }

          expect(yield* ctx.test.calls).toBe(2)
          expect(ctx.handle.message.finish).toBe("stop")
          const parts = yield* MessageV2.parts(ctx.msg.id)
          expect(parts.map((part) => part.type)).toEqual(["step-start", "text", "step-finish"])
          expect(parts.some((part) => part.type === "reasoning")).toBe(false)
          expect(parts.find((part) => part.type === "text")?.text).toBe("Recovered")
        }),
      { git: true },
    ),
  )

  it.effect("stops after two empty response retries", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(...empty())
          yield* ctx.test.reply(...empty())
          yield* ctx.test.reply(...empty())
          yield* ctx.test.push(Stream.fail(new Error("unexpected extra llm call")))
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("stop")
          } finally {
            delay.mockRestore()
          }

          expect(yield* ctx.test.calls).toBe(3)
          expect(ctx.handle.message.finish).toBe("unknown")
          const error = ctx.handle.message.error
          expect(MessageV2.APIError.isInstance(error)).toBe(true)
          if (!MessageV2.APIError.isInstance(error)) throw new Error("expected API error")
          expect(error.data.message).toBe(KiloSessionProcessor.INCOMPLETE_RESPONSE_MESSAGE)
          expect(yield* MessageV2.parts(ctx.msg.id)).toEqual([])
        }),
      { git: true },
    ),
  )

  it.effect("retries when the stream drains without a finish event", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(LLMEvent.stepStart({ index: 0 }))
          yield* ctx.test.reply(...success())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          } finally {
            delay.mockRestore()
          }

          expect(yield* ctx.test.calls).toBe(2)
          expect((yield* MessageV2.parts(ctx.msg.id)).map((part) => part.type)).toEqual([
            "step-start",
            "text",
            "step-finish",
          ])
        }),
      { git: true },
    ),
  )

  it.effect("does not retry non-empty reasoning", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.reasoningStart({ id: "reasoning-1" }),
            LLMEvent.reasoningDelta({ id: "reasoning-1", text: "Investigating the problem" }),
            LLMEvent.reasoningEnd({ id: "reasoning-1" }),
            LLMEvent.reasoningStart({ id: "reasoning-2" }),
            LLMEvent.reasoningDelta({ id: "reasoning-2", text: "Preparing the final answer" }),
            LLMEvent.reasoningEnd({ id: "reasoning-2" }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "unknown", usage }),
          )
          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")

          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.finish).toBe("unknown")
          const parts = yield* MessageV2.parts(ctx.msg.id)
          expect(parts.filter((part) => part.type === "reasoning").map((part) => part.text)).toEqual([
            "Investigating the problem",
            "Preparing the final answer",
          ])
        }),
      { git: true },
    ),
  )

  it.effect("removes incomplete tool framing before retrying", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.toolInputStart({ id: "call", name: "write" }),
            LLMEvent.toolInputDelta({ id: "call", name: "write", text: "{\"path\":" }),
          )
          yield* ctx.test.reply(...success())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          } finally {
            delay.mockRestore()
          }

          expect(yield* ctx.test.calls).toBe(2)
          const parts = yield* MessageV2.parts(ctx.msg.id)
          expect(parts.some((part) => part.type === "tool")).toBe(false)
          expect(parts.find((part) => part.type === "text")?.text).toBe("Recovered")
        }),
      { git: true },
    ),
  )

  it.effect("does not retry partial visible output", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.textStart({ id: "partial" }),
            LLMEvent.textDelta({ id: "partial", text: "Partial" }),
            LLMEvent.textEnd({ id: "partial" }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "unknown", usage }),
          )

          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.finish).toBe("unknown")
          expect((yield* MessageV2.parts(ctx.msg.id)).find((part) => part.type === "text")?.text).toBe("Partial")
        }),
      { git: true },
    ),
  )

  it.effect("does not retry a complete tool call", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.toolCall({ id: "call", name: "web_search", input: { query: "Kilo" }, providerExecuted: true }),
            LLMEvent.toolResult({
              id: "call",
              name: "web_search",
              result: { type: "json", value: { output: "result" } },
              providerExecuted: true,
            }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "unknown", usage }),
          )

          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          expect(yield* ctx.test.calls).toBe(1)
          expect((yield* MessageV2.parts(ctx.msg.id)).some((part) => part.type === "tool")).toBe(true)
        }),
      { git: true },
    ),
  )

  it.effect("does not retry an unmatched tool error", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.toolError({ id: "missing", name: "web_search", message: "provider tool failed" }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "unknown", usage }),
          )

          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.finish).toBe("unknown")
        }),
      { git: true },
    ),
  )

  it.effect("does not retry an unknown finish with non-zero usage", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({ inputTokens: 10, outputTokens: 1, totalTokens: 11 })
          const empty = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "unknown", usage: empty }),
          )

          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.finish).toBe("unknown")
          expect(ctx.handle.message.tokens.input).toBe(10)
        }),
      { git: true },
    ),
  )

  it.effect("uses step finish instead of a conflicting final finish", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          const usage = new Usage({})
          yield* ctx.test.reply(
            LLMEvent.stepStart({ index: 0 }),
            LLMEvent.reasoningStart({ id: "reasoning" }),
            LLMEvent.reasoningEnd({ id: "reasoning" }),
            LLMEvent.stepFinish({ index: 0, reason: "unknown", usage }),
            LLMEvent.finish({ reason: "stop", usage }),
          )
          yield* ctx.test.reply(...success())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          } finally {
            delay.mockRestore()
          }

          expect(yield* ctx.test.calls).toBe(2)
          expect(ctx.handle.message.finish).toBe("stop")
        }),
      { git: true },
    ),
  )

  it.effect("keeps provider retries independent after an empty response", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          process.env.KILO_SESSION_RETRY_LIMIT = "2"
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(...empty())
          yield* ctx.test.push(Stream.fail(retryable429()))
          yield* ctx.test.push(Stream.fail(retryable429()))
          yield* ctx.test.reply(...success())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          } finally {
            delay.mockRestore()
            delete process.env.KILO_SESSION_RETRY_LIMIT
          }

          expect(yield* ctx.test.calls).toBe(4)
          expect(ctx.handle.message.finish).toBe("stop")
        }),
      { git: true },
    ),
  )

  it.effect("does not retry a provider error after final output", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          const ctx = yield* setup(dir)
          yield* ctx.test.push(
            Stream.make(
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.textStart({ id: "partial" }),
              LLMEvent.textDelta({ id: "partial", text: "Partial" }),
            ).pipe(Stream.concat(Stream.fail(retryable429()))),
          )
          yield* ctx.test.reply(...empty())
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("stop")
          } finally {
            delay.mockRestore()
            delete process.env.KILO_SESSION_RETRY_LIMIT
          }

          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.error).toBeDefined()
          expect((yield* MessageV2.parts(ctx.msg.id)).some((part) => part.type === "text")).toBe(true)
        }),
      { git: true },
    ),
  )

  it.effect("keeps the provider retry budget cumulative across incomplete retries", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          process.env.KILO_SESSION_RETRY_LIMIT = "2"
          const ctx = yield* setup(dir)
          yield* ctx.test.push(Stream.fail(retryable429()))
          yield* ctx.test.reply(...empty())
          yield* ctx.test.push(Stream.fail(retryable429()))
          yield* ctx.test.push(Stream.fail(retryable429()))
          const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

          try {
            expect(yield* ctx.handle.process(ctx.input)).toBe("stop")
          } finally {
            delay.mockRestore()
            delete process.env.KILO_SESSION_RETRY_LIMIT
          }

          expect(yield* ctx.test.calls).toBe(4)
          expect(MessageV2.APIError.isInstance(ctx.handle.message.error)).toBe(true)
        }),
      { git: true },
    ),
  )

  eventIt.effect("does not retry when Event V2 mirroring is enabled", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const ctx = yield* setup(dir)
          yield* ctx.test.reply(...empty())

          expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
          expect(yield* ctx.test.calls).toBe(1)
          expect(ctx.handle.message.finish).toBe("unknown")
        }),
      { git: true },
    ),
  )
})
