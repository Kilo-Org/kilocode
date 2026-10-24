// A retryable failure that arrives after the model already streamed output used
// to abort the turn (#15042). These cover the mid-stream retry path: the retry
// only happens for transient failures, and the failed attempt's output is
// dropped so the retried attempt does not layer on top of it.
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
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
>()("@test/MidStreamRetryLLM") {}

class State extends Context.Service<State, { readonly queue: Script[]; calls: number }>()(
  "@test/MidStreamRetryState",
) {}

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

function gatewayTimeout() {
  return new APICallError({
    message: "Upstream idle timeout exceeded",
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 504,
    responseHeaders: { "content-type": "application/json" },
    isRetryable: true,
  })
}

function unauthorized() {
  return new APICallError({
    message: "401 status code (no body)",
    url: "https://example.test/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 401,
    responseHeaders: { "content-type": "application/json" },
    isRetryable: false,
  })
}

const usage = new Usage({ inputTokens: 10, outputTokens: 2, totalTokens: 12 })

/** Streams half an answer, then fails mid-stream. */
function partial(error: unknown) {
  return Stream.concat(
    Stream.make(
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.textStart({ id: "text" }),
      LLMEvent.textDelta({ id: "text", text: "half " }),
    ),
    Stream.fail(error),
  )
}

function answer(text: string) {
  return Stream.make(
    LLMEvent.stepStart({ index: 0 }),
    LLMEvent.textStart({ id: "text" }),
    LLMEvent.textDelta({ id: "text", text }),
    LLMEvent.textEnd({ id: "text" }),
    LLMEvent.stepFinish({ index: 0, reason: "stop", usage }),
    LLMEvent.finish({ reason: "stop", usage }),
  )
}

/** The same, but the provider already handed the tool call to the provider-side runtime. */
function partialToolCall(error: unknown) {
  return Stream.concat(
    Stream.make(
      LLMEvent.stepStart({ index: 0 }),
      LLMEvent.toolInputStart({ id: "call-1", name: "read" }),
      LLMEvent.toolInputEnd({ id: "call-1", name: "read" }),
      LLMEvent.toolCall({ id: "call-1", name: "read", input: { filePath: "package.json" }, providerExecuted: true }),
      LLMEvent.toolResult({
        id: "call-1",
        name: "read",
        result: { type: "error", value: "no such file" },
        providerExecuted: true,
      }),
    ),
    Stream.fail(error),
  )
}

const reference = Layer.mock(Reference.Service, {
  list: () => Effect.succeed([]),
})
const stateNode = LayerNode.make({
  service: State,
  layer: Layer.sync(State, () => State.of({ queue: [], calls: 0 })),
  deps: [],
})
const llmNode = LayerNode.make({
  service: LLM.Service,
  layer: Layer.effect(
    LLM.Service,
    Effect.gen(function* () {
      const state = yield* State
      return LLM.Service.of({
        stream: () => {
          state.calls += 1
          return state.queue.shift() ?? Stream.fail(new Error("unexpected extra llm call"))
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
const env = LayerNode.compile(root, [
  [LLM.node, llmNode],
  [RuntimeFlags.node, RuntimeFlags.layer()],
]).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, Bus.layer, SyncEvent.defaultLayer, reference)))

const it = testEffect(env)

const setup = Effect.fn("SessionProcessorMidStreamRetryTest.setup")(function* (dir: string) {
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
  return { test, msg, handle, input }
})

const run = (...scripts: Script[]) =>
  provideTmpdirProject(
    (dir) =>
      Effect.gen(function* () {
        const ctx = yield* setup(dir)
        yield* Effect.forEach(scripts, (script) => ctx.test.push(script))
        const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)
        try {
          return { ...ctx, result: yield* ctx.handle.process(ctx.input) }
        } finally {
          delay.mockRestore()
        }
      }),
    { git: true },
  )

describe("session processor mid-stream retry", () => {
  it.effect("retries a 504 that arrives after partial text and drops the failed attempt", () =>
    Effect.gen(function* () {
      const ctx = yield* run(partial(gatewayTimeout()), answer("whole"))

      expect(ctx.result).toBe("continue")
      expect(yield* ctx.test.calls).toBe(2)
      expect(ctx.handle.message.error).toBeUndefined()
      expect(ctx.handle.message.finish).toBe("stop")
      const parts = yield* MessageV2.parts(ctx.msg.id)
      expect(parts.map((part) => part.type)).toEqual(["step-start", "text", "step-finish"])
      expect(parts.find((part) => part.type === "text")?.text).toBe("whole")
    }),
  )

  it.effect("keeps the partial output of a terminal failure", () =>
    Effect.gen(function* () {
      const ctx = yield* run(partial(unauthorized()), Stream.fail(new Error("unexpected extra llm call")))

      expect(ctx.result).toBe("stop")
      expect(yield* ctx.test.calls).toBe(1)
      expect(MessageV2.APIError.isInstance(ctx.handle.message.error)).toBe(true)
      const parts = yield* MessageV2.parts(ctx.msg.id)
      expect(parts.find((part) => part.type === "text")?.text).toBe("half ")
    }),
  )

  it.effect("does not retry after a tool call so side effects cannot run twice", () =>
    Effect.gen(function* () {
      const ctx = yield* run(partialToolCall(gatewayTimeout()), Stream.fail(new Error("unexpected extra llm call")))

      expect(ctx.result).toBe("stop")
      expect(yield* ctx.test.calls).toBe(1)
      expect(MessageV2.APIError.isInstance(ctx.handle.message.error)).toBe(true)
      const parts = yield* MessageV2.parts(ctx.msg.id)
      expect(parts.find((part) => part.type === "tool")?.tool).toBe("read")
    }),
  )
})
