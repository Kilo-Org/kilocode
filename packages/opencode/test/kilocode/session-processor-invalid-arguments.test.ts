import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer, Schema } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent, type LLMEvent as Event } from "@opencode-ai/llm"
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
import { Session } from "../../src/session/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import { InvalidArgumentsError, Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
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
    readonly reply: (...items: Event[]) => Effect.Effect<void>
    readonly script: (item: Script) => Effect.Effect<void>
  }
>()("@test/InvalidArgumentsLLM") {}

class State extends Context.Service<State, { readonly queue: Script[] }>()("@test/InvalidArgumentsState") {}

function model(selection = ref): Provider.Model {
  return {
    id: selection.modelID,
    providerID: selection.providerID,
    name: "Test",
    limit: { context: 128000, output: 4096 },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    capabilities: {
      toolcall: true,
      attachment: false,
      reasoning: false,
      temperature: true,
      input: { text: true, image: false, audio: false, video: false },
      output: { text: true, image: false, audio: false, video: false },
    },
    api: { npm: "@ai-sdk/openai" },
    options: {},
  } as Provider.Model
}

function usage() {
  return { inputTokens: 100, outputTokens: 41, totalTokens: 141 }
}

const stateNode = LayerNode.make({
  service: State,
  layer: Layer.sync(State, () => State.of({ queue: [] })),
  deps: [],
})
const llmNode = LayerNode.make({
  service: LLM.Service,
  layer: Layer.effect(
    LLM.Service,
    Effect.gen(function* () {
      const state = yield* State
      return LLM.Service.of({ stream: () => state.queue.shift() ?? Stream.empty })
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
      const push = (item: Script) => Effect.sync(() => state.queue.push(item)).pipe(Effect.asVoid)
      return TestLLM.of({ reply: (...items) => push(Stream.make(...items)), script: push })
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
]).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, Bus.layer, SyncEvent.defaultLayer)))

const it = testEffect(env)

const detail = '["filePath"]: is missing and is required'

function invalid(index: number, message = detail): Event[] {
  const id = `call-${index}`
  return [
    LLMEvent.toolInputStart({ id, name: "edit" }),
    LLMEvent.toolCall({ id, name: "edit", input: { value: `malformed-${index}` } }),
    LLMEvent.toolError({
      id,
      name: "edit",
      message: "invalid arguments",
      error: new InvalidArgumentsError({ tool: "edit", detail: message }),
    }),
  ]
}

function step(index: number, ...events: Event[]): Event[] {
  return [
    LLMEvent.stepStart({ index }),
    ...events,
    LLMEvent.stepFinish({ index, reason: "tool-calls", usage: usage() }),
  ]
}

function success(index: number): Event[] {
  const id = `ok-${index}`
  return [
    LLMEvent.toolInputStart({ id, name: "edit" }),
    LLMEvent.toolCall({ id, name: "edit", input: { value: `good-${index}` } }),
    LLMEvent.toolResult({ id, name: "edit", result: { type: "text", value: "ok" } }),
  ]
}

function failure(index: number): Event[] {
  const id = `err-${index}`
  return [
    LLMEvent.toolInputStart({ id, name: "bash" }),
    LLMEvent.toolCall({ id, name: "bash", input: { command: `cmd-${index}` } }),
    LLMEvent.toolError({ id, name: "bash", message: "command failed", error: new Error("command failed") }),
  ]
}

const turn = Effect.fn("InvalidArgumentsTest.turn")(function* (dir: string) {
  const session = yield* Session.Service
  const chat = yield* session.create({})
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "code",
    model: ref,
    time: { created: Date.now() },
  })
  return { session, chat, user, model: model(), dir }
})

// Mirrors the prompt loop: every model step creates a new assistant message and
// processor, so the circuit breaker state must survive across these calls.
const run = Effect.fn("InvalidArgumentsTest.run")(function* (
  input: Effect.Success<ReturnType<typeof turn>>,
  events: Event[],
) {
  const test = yield* TestLLM
  const processors = yield* SessionProcessor.Service
  yield* test.reply(...events, LLMEvent.finish({ reason: "tool-calls", usage: usage() }))

  const message: MessageV2.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: input.chat.id,
    parentID: input.user.id,
    mode: "code",
    agent: "code",
    path: { cwd: path.resolve(input.dir), root: path.resolve(input.dir) },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
  yield* input.session.updateMessage(message)
  const handle = yield* processors.create({ assistantMessage: message, sessionID: input.chat.id, model: input.model })
  const stream: LLM.StreamInput = {
    user: input.user as MessageV2.User,
    sessionID: input.chat.id,
    model: input.model,
    agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
    system: [],
    messages: [],
    tools: {},
  }
  const result = yield* handle.process(stream)
  return { result, message }
})

describe("session processor invalid-argument circuit breaker", () => {
  it.effect("aborts the turn after three identical invalid-argument failures", () =>
    provideTmpdirProject((dir) =>
      Effect.gen(function* () {
        const state = yield* turn(dir)
        yield* run(state, step(0, ...invalid(1)))
        yield* run(state, step(1, ...invalid(2)))
        const last = yield* run(state, step(2, ...invalid(3)))
        expect(last.result).toBe("stop")
        expect(last.message.error?.name).toBe("APIError")
        if (last.message.error?.name !== "APIError") return
        expect(last.message.error.data.message).toContain("consecutive invalid-argument failures")
        expect(last.message.error.data.isRetryable).toBe(false)
      }),
    ),
  )

  it.effect("aborts when the same tool alternates malformed details", () =>
    provideTmpdirProject((dir) =>
      Effect.gen(function* () {
        const state = yield* turn(dir)
        yield* run(state, step(0, ...invalid(1, '["filePath"]: is missing and is required')))
        yield* run(state, step(1, ...invalid(2, '["oldString"]: is missing and is required')))
        const last = yield* run(state, step(2, ...invalid(3, '["newString"]: is missing and is required')))
        expect(last.result).toBe("stop")
        expect(last.message.error?.name).toBe("APIError")
        if (last.message.error?.name !== "APIError") return
        expect(last.message.error.data.message).toContain("consecutive invalid-argument failures")
      }),
    ),
  )

  it.effect("keeps the turn alive when a completed tool call breaks the streak", () =>
    provideTmpdirProject((dir) =>
      Effect.gen(function* () {
        const state = yield* turn(dir)
        yield* run(state, step(0, ...invalid(1)))
        yield* run(state, step(1, ...invalid(2)))
        yield* run(state, step(2, ...success(1)))
        yield* run(state, step(3, ...invalid(3)))
        const last = yield* run(state, step(4, ...invalid(4)))
        expect(last.result).toBe("continue")
        expect(last.message.error).toBeUndefined()
      }),
    ),
  )

  it.effect("does not trip when unrelated tool failures break the streak", () =>
    provideTmpdirProject((dir) =>
      Effect.gen(function* () {
        const state = yield* turn(dir)
        yield* run(state, step(0, ...invalid(1)))
        yield* run(state, step(1, ...failure(1)))
        yield* run(state, step(2, ...invalid(2)))
        yield* run(state, step(3, ...failure(2)))
        const last = yield* run(state, step(4, ...invalid(3)))
        expect(last.result).toBe("continue")
        expect(last.message.error).toBeUndefined()
      }),
    ),
  )
})

const toolEnv = LayerNode.compile(LayerNode.group([Truncate.node, AgentSvc.node]))
const itTool = testEffect(toolEnv)

function toolCtx(): Tool.Context {
  return {
    sessionID: SessionID.descending(),
    messageID: MessageID.ascending(),
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata() {
      return Effect.void
    },
    ask() {
      return Effect.void
    },
  }
}

// The circuit breaker keys off `error instanceof InvalidArgumentsError`. The tool
// wrapper runs through `Effect.orDie` and the AI SDK forwards whatever the tool
// rejects with, so pin that the typed error survives `run.promise` unchanged.
describe("tool invalid-argument error identity", () => {
  itTool.effect("run.promise rejects with the original InvalidArgumentsError", () =>
    Effect.gen(function* () {
      const info = yield* Tool.define(
        "grep",
        Effect.succeed({
          description: "test tool",
          parameters: Schema.Struct({ pattern: Schema.String }),
          execute() {
            return Effect.succeed({ title: "ok", output: "ok", metadata: {} })
          },
        }),
      )
      const tool = yield* info.init()
      const execute = tool.execute as unknown as (args: unknown, ctx: Tool.Context) => Effect.Effect<unknown, unknown>
      const rejected = yield* Effect.promise(() =>
        Effect.runPromise(execute({}, toolCtx()) as Effect.Effect<unknown>).then(
          () => undefined,
          (error: unknown) => error,
        ),
      )
      expect(rejected).toBeInstanceOf(InvalidArgumentsError)
      if (!(rejected instanceof InvalidArgumentsError)) return
      expect(rejected.tool).toBe("grep")
      expect(rejected.detail).toContain("pattern")
    }),
  )
})
