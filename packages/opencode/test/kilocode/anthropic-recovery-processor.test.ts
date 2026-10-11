import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, spyOn } from "bun:test"
import { APICallError } from "ai"
import { Context, Effect, Layer, Logger } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, Usage, Tool as NativeTool, ToolRuntime, type LLMEvent as Event } from "@opencode-ai/llm"
import { Database } from "@opencode-ai/core/database/database"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Image } from "../../src/image/image"
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
import fixture from "./fixtures/anthropic-thinking-error.json"

await Log.init({ print: false })

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
    readonly executions: Effect.Effect<number>
    readonly inputs: Effect.Effect<LLM.StreamInput[]>
  }
>()("@test/IncompleteResponseRetryLLM") {}

class State extends Context.Service<
  State,
  { readonly queue: Script[]; calls: number; executions: number; inputs: LLM.StreamInput[] }
>()("@test/IncompleteResponseRetryState") {}

function model(): Provider.Model {
  return {
    id: ref.modelID,
    providerID: ref.providerID,
    name: "Test",
    limit: { context: 128000, input: 128000, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: true,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false, pdf: false },
      output: { text: true, image: false, audio: false, video: false, pdf: false },
      interleaved: false,
    },
    api: { npm: "@ai-sdk/anthropic", id: "claude-opus-5-5", url: "http://fixture/v1/messages" },
    options: {},
    headers: {},
    status: "active",
    release_date: "2026-01-01",
  }
}

function empty(vercelID?: string) {
  const usage = new Usage({})
  const providerMetadata = vercelID ? { kilo: { vercelID } } : undefined
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.reasoningStart({ id: "reasoning" }),
    LLMEvent.reasoningEnd({ id: "reasoning" }),
    LLMEvent.stepFinish({ index: 0, reason: "unknown", usage, providerMetadata }),
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

const reference = Layer.mock(Reference.Service, {
  list: () => Effect.succeed([]),
})
const stateNode = LayerNode.make({
  service: State,
  layer: Layer.sync(State, () => State.of({ queue: [], calls: 0, executions: 0, inputs: [] })),
  deps: [],
})
const llmNode = LayerNode.make({
  service: LLM.Service,
  layer: Layer.effect(
    LLM.Service,
    Effect.gen(function* () {
      const state = yield* State
      return LLM.Service.of({
        stream: (input) => {
          state.calls += 1
          state.inputs.push({ ...input, messages: structuredClone(input.messages) })
          const scripted = state.queue.shift() ?? Stream.fail(new Error("unexpected extra llm call"))
          return scripted.pipe(
            Stream.flatMap((event) =>
              event.type !== "tool-call"
                ? Stream.make(event)
                : Stream.make(event).pipe(
                    Stream.concat(
                      Stream.unwrap(
                        ToolRuntime.dispatch(
                          {
                            read: NativeTool.make({
                              description: "Fixture read",
                              jsonSchema: { type: "object" },
                              execute: () =>
                                Effect.sync(() => {
                                  state.executions++
                                  return { type: "text", value: "25" }
                                }),
                            }),
                          },
                          event,
                        ).pipe(Effect.map((result) => Stream.fromIterable(result.events))),
                      ),
                    ),
                  ),
            ),
          )
        },
      })
    }),
  ),
  deps: [stateNode],
})
const testNode = LayerNode.make({
  service: TestLLM,
  layer: Layer.effect(
    TestLLM,
    Effect.gen(function* () {
      const state = yield* State
      const push = (stream: Script) => Effect.sync(() => state.queue.push(stream)).pipe(Effect.asVoid)
      return TestLLM.of({
        push,
        reply: (...events) => push(Stream.make(...events)),
        calls: Effect.sync(() => state.calls),
        executions: Effect.sync(() => state.executions),
        inputs: Effect.sync(() => state.inputs),
      })
    }),
  ),
  deps: [stateNode],
})
const root = LayerNode.group([
  SessionProcessor.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  AgentSvc.node,
  Permission.node,
  Plugin.node,
  Config.node,
  SessionSummary.node,
  Image.node,
  SessionStatus.node,
  EventV2Bridge.node,
  Database.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  LLM.node,
  testNode,
])
const env = (event = false) =>
  LayerNode.compile(root, [
    [LLM.node, llmNode],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: event })],
  ]).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, Bus.layer, SyncEvent.defaultLayer, reference)))

const it = testEffect(env())

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
  const agents = yield* AgentSvc.Service
  const agent = yield* agents.get("code")
  if (!agent) throw new Error("Fixture agent missing")
  const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
  const input: LLM.StreamInput = {
    user: parent,
    sessionID: chat.id,
    model: mdl,
    agent,
    system: [],
    messages: [],
    tools: {},
  }
  return { test, session, msg, handle, input }
})

function rejected(message = fixture.message, statusCode = fixture.statusCode) {
  return new APICallError({
    message,
    statusCode,
    isRetryable: statusCode >= 500,
    url: "http://fixture/v1/messages",
    requestBodyValues: {},
    responseBody: JSON.stringify({ type: "error", error: { type: fixture.type, message } }),
  })
}

function signedTool() {
  const usage = new Usage({ inputTokens: 20, outputTokens: 35 })
  return [
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.reasoningStart({ id: "A" }),
    LLMEvent.reasoningDelta({ id: "A", text: "thinkingA" }),
    LLMEvent.reasoningEnd({ id: "A", providerMetadata: { anthropic: { signature: "signatureA" } } }),
    LLMEvent.reasoningStart({ id: "B" }),
    LLMEvent.reasoningDelta({ id: "B", text: "thinkingB" }),
    LLMEvent.reasoningEnd({ id: "B", providerMetadata: { anthropic: { signature: "signatureB" } } }),
    LLMEvent.toolInputStart({ id: "read1", name: "read" }),
    LLMEvent.toolCall({ id: "read1", name: "read", input: {} }),
    LLMEvent.stepFinish({ index: 0, reason: "tool-calls", usage }),
    LLMEvent.finish({ reason: "tool-calls", usage }),
  ]
}

const continuation = Effect.fn("AnthropicRecoveryTest.continuation")(function* (dir: string) {
  const ctx = yield* setup(dir)
  yield* ctx.test.reply(...signedTool())
  expect(yield* ctx.handle.process(ctx.input)).toBe("continue")
  expect(yield* ctx.test.executions).toBe(1)
  const original = yield* MessageV2.parts(ctx.msg.id)
  const history = yield* ctx.session.messages({ sessionID: ctx.msg.sessionID })
  const messages = yield* MessageV2.toModelMessagesEffect(history, ctx.input.model)
  const processors = yield* SessionProcessor.Service
  const next = { ...ctx.msg, id: MessageID.ascending(), time: { created: Date.now() }, finish: undefined }
  yield* ctx.session.updateMessage(next)
  const handle = yield* processors.create({
    assistantMessage: next,
    sessionID: ctx.msg.sessionID,
    model: ctx.input.model,
  })
  return { ...ctx, original, handle, input: { ...ctx.input, messages } }
})

const logs: unknown[] = []
const logger = Logger.make<unknown, void>((options) => {
  logs.push(options.message)
})

describe("Anthropic thinking recovery processor", () => {
  const run = (
    name: string,
    scripts: () => Script[],
    expected: { status?: number; calls: number; excluded: boolean },
  ) =>
    it.live(
      name,
      () =>
        provideTmpdirProject(
          (dir) =>
            Effect.gen(function* () {
              const ctx = yield* continuation(dir)
              const database = yield* Database.Service
              for (const [index, stream] of scripts().entries()) {
                const verified =
                  index > 0 && expected.excluded
                    ? Stream.unwrap(
                        Effect.gen(function* () {
                          const persisted = yield* MessageV2.parts(ctx.msg.id)
                          expect(
                            persisted
                              .filter((part) => part.type === "reasoning")
                              .every(
                                (part) =>
                                  part.metadata?.["kilocode.anthropic-replay-exclusion"]?.error === fixture.message,
                              ),
                          ).toBe(true)
                          return stream
                        }).pipe(Effect.provideService(Database.Service, database)),
                      )
                    : stream
                yield* ctx.test.push(verified)
              }
              const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)
              const before = logs.length
              const result = yield* ctx.handle
                .process(ctx.input)
                .pipe(
                  Effect.provide(Logger.layer([logger], { mergeWithExisting: false })),
                  Effect.ensuring(Effect.sync(() => delay.mockRestore())),
                )
              expect(result).toBe(expected.status ? "stop" : "continue")
              expect(yield* ctx.test.calls).toBe(expected.calls)
              expect(yield* ctx.test.executions).toBe(1)
              if (expected.excluded) {
                const beforeRetry = yield* ctx.test.inputs
                const second = beforeRetry.at(2)
                expect(second?.messages.findLast((message) => message.role === "assistant")?.content).toEqual(
                  expect.arrayContaining([expect.objectContaining({ type: "tool-call", toolCallId: "read1" })]),
                )
              }
              const stored = yield* MessageV2.parts(ctx.msg.id)
              const originals = ctx.original.filter((part) => part.type === "reasoning")
              const reasoning = stored.filter((part) => part.type === "reasoning")
              expect(
                reasoning.map((part) => ({ text: part.text, signature: part.metadata?.anthropic?.signature })),
              ).toEqual(originals.map((part) => ({ text: part.text, signature: part.metadata?.anthropic?.signature })))
              expect(reasoning.every((part) => Boolean(part.metadata?.["kilocode.anthropic-replay-exclusion"]))).toBe(
                expected.excluded,
              )
              if (expected.excluded) {
                const fork = yield* ctx.session.fork({ sessionID: ctx.msg.sessionID })
                const forked = yield* ctx.session.messages({ sessionID: fork.id })
                const replay = yield* MessageV2.toModelMessagesEffect(forked, ctx.input.model)
                expect(
                  replay
                    .filter((message) => message.role === "assistant")
                    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                    .some((part) => part.type === "reasoning"),
                ).toBe(false)
              }
              expect(
                (yield* ctx.session.get(ctx.msg.sessionID)).metadata?.["kilocode.anthropic-replay-exclusion"],
              ).toBeUndefined()
              if (expected.excluded) {
                expect(
                  reasoning.every(
                    (part) => part.metadata?.["kilocode.anthropic-replay-exclusion"].error === fixture.message,
                  ),
                ).toBe(true)
                const inputs = yield* ctx.test.inputs
                const repaired = inputs.at(2)
                expect(
                  repaired?.messages
                    .filter((message) => message.role === "assistant")
                    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                    .some((part) => part.type === "reasoning"),
                ).toBe(false)
                expect(reasoning.map((part) => part.metadata?.["kilocode.anthropic-replay-exclusion"].error)).toEqual([
                  fixture.message,
                  fixture.message,
                ])
                expect(logs.slice(before)).toContainEqual([
                  "Anthropic latest thinking excluded from replay; retrying once",
                  expect.objectContaining({
                    sessionID: ctx.msg.sessionID,
                    messageID: ctx.msg.id,
                    excluded: 2,
                    error: fixture.message,
                  }),
                ])
              }
              if (expected.status) {
                expect(ctx.handle.message.error?.name).toBe("APIError")
                if (ctx.handle.message.error?.name !== "APIError") throw new Error("Expected APIError")
                expect(ctx.handle.message.error.data.statusCode).toBe(expected.status)
              } else expect(ctx.handle.message.error).toBeUndefined()
            }),
          { git: true },
        ),
      240000,
    )

  run(
    "persists exact400 exclusion before repaired success without rerunning the completed tool",
    () => [Stream.fail(rejected()), Stream.make(...success())],
    { calls: 3, excluded: true },
  )
  run(
    "surfaces a second identical400 without a second repair",
    () => [Stream.fail(rejected()), Stream.fail(rejected())],
    { calls: 3, excluded: true, status: 400 },
  )
  run("leaves other400 unchanged", () => [Stream.fail(rejected("other400"))], {
    calls: 2,
    excluded: false,
    status: 400,
  })
  run(
    "does not repair a rejected attempt that produced output",
    () => [
      Stream.make(LLMEvent.textStart({ id: "partial" }), LLMEvent.textDelta({ id: "partial", text: "partial" })).pipe(
        Stream.concat(Stream.fail(rejected())),
      ),
    ],
    { calls: 2, excluded: false, status: 400 },
  )
  run(
    "normal provider retries recover503 after one exclusion",
    () => [Stream.fail(rejected()), Stream.fail(rejected("503 service unavailable", 503)), Stream.make(...success())],
    { calls: 4, excluded: true },
  )
  run(
    "persistent503 surfaces normal503 instead of old400",
    () => [
      Stream.fail(rejected()),
      ...Array.from({ length: 7 }, () => Stream.fail(rejected("503 service unavailable", 503))),
    ],
    { calls: 8, excluded: true, status: 503 },
  )
  run(
    "repaired incomplete response follows normal incomplete handling",
    () => [Stream.fail(rejected()), Stream.make(...empty()), Stream.make(...success())],
    { calls: 4, excluded: true },
  )
})
