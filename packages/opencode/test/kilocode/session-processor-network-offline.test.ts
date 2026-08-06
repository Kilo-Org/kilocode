import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect, spyOn } from "bun:test"
import { Context, Effect, Layer } from "effect"
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
import { SessionNetwork } from "../../src/session/network"
import { SessionProcessor } from "../../src/session/processor"
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
  }
>()("@test/OfflineLLM") {}

class State extends Context.Service<State, { readonly queue: Script[] }>()("@test/OfflineLLMState") {}

function model(): Provider.Model {
  return {
    id: "test-model",
    providerID: "test",
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
  return {
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
  }
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
      return TestLLM.of({
        push: (item) => Effect.sync(() => state.queue.push(item)).pipe(Effect.asVoid),
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
]).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, Bus.layer, SyncEvent.defaultLayer)))

const it = testEffect(env)

describe("session processor network offline", () => {
  it.effect("enters offline state for provider connection message", () =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          const err = new Error("Unable to connect. Is the computer able to access the url?")

          // First call: network error via Stream.fail; second call: success
          yield* test.push(Stream.fail(err))
          yield* test.push(
            Stream.make(
              LLMEvent.stepStart({ index: 0 }),
              LLMEvent.stepFinish({ index: 0, reason: "stop", usage: usage() }),
              LLMEvent.finish({ reason: "stop", usage: usage() }),
            ),
          )

          // Auto-reply to network reconnect request
          const offAsk = Bus.subscribe(SessionNetwork.Event.Asked, (event) => {
            void SessionNetwork.reply({ requestID: event.properties.id })
          })
          const ask = spyOn(SessionNetwork, "ask")

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
          const handle = yield* processors.create({
            assistantMessage: msg,
            sessionID: chat.id,
            model: mdl,
          })

          const input: LLM.StreamInput = {
            user: parent as MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
            system: [],
            messages: [],
            tools: {},
          }

          try {
            const result = yield* handle.process(input)
            expect(result).toBe("continue")
            expect(ask).toHaveBeenCalledTimes(1)
            // Verify the offline handler was invoked with the correct message
            const call = ask.mock.calls[0]
            expect(call[0]).toMatchObject({
              sessionID: chat.id,
              message: err.message,
            })
          } finally {
            offAsk()
            ask.mockRestore()
          }
        }),
      { git: true },
    ),
  )
})
