import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import path from "path"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Config } from "../../src/config"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import type { Provider } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
import { KiloSessionProcessor } from "../../src/kilocode/session/processor"
import { Log } from "../../src/util"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { provideTmpdirInstance } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

type Script = Stream.Stream<LLM.Event, unknown>

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly reply: (...items: LLM.Event[]) => Effect.Effect<void>
  }
>()("@test/EmptyToolCallsLLM") {}

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
    inputTokens: 100,
    outputTokens: 41,
    totalTokens: 141,
  }
}

const llm = Layer.unwrap(
  Effect.gen(function* () {
    const queue: Script[] = []
    const push = (item: Script) => {
      queue.push(item)
      return Effect.void
    }
    const reply = (...items: LLM.Event[]) => push(Stream.make(...items))
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: () => {
            const item = queue.shift() ?? Stream.empty
            return item
          },
          raw: () => Effect.die("raw not implemented in TestLLM"),
        }),
      ),
      Layer.succeed(TestLLM, TestLLM.of({ reply })),
    )
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  SessionSummary.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra))
const env = SessionProcessor.layer.pipe(Layer.provideMerge(deps))

const it = testEffect(env)

describe("session processor empty tool-calls", () => {
  it.effect("converts finish to stop when model returns tool-calls with no tools", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            { type: "start" },
            {
              type: "start-step",
            } as LLM.Event,
            {
              type: "finish-step",
              finishReason: "tool-calls",
              usage: usage(),
              providerMetadata: undefined,
            } as LLM.Event,
            { type: "finish" } as LLM.Event,
          )

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

          yield* handle.process(input)
          expect(handle.message.finish).toBe("stop")
          const parts = MessageV2.parts(msg.id)
          const tools = parts.filter((p) => p.type === "tool")
          expect(tools.length).toBe(0)
        }),
      { git: true },
    ),
  )

  it.effect("adds warning when model stops after reasoning-only length finish", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            { type: "start" },
            { type: "start-step" } as LLM.Event,
            { type: "reasoning-start", id: "reasoning", providerMetadata: undefined } as LLM.Event,
            { type: "reasoning-delta", id: "reasoning", text: "thinking", providerMetadata: undefined } as LLM.Event,
            { type: "reasoning-end", id: "reasoning", providerMetadata: undefined } as LLM.Event,
            {
              type: "finish-step",
              finishReason: "length",
              usage: usage(),
              providerMetadata: undefined,
            } as LLM.Event,
            { type: "finish" } as LLM.Event,
          )

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

          yield* handle.process(input)
          const parts = MessageV2.parts(msg.id)
          const warning = parts.find(
            (part): part is MessageV2.TextPart =>
              part.type === "text" && part.text === KiloSessionProcessor.REASONING_LENGTH_WARNING,
          )

          expect(warning?.ignored).toBe(true)

          const modelMsgs = yield* MessageV2.toModelMessagesEffect([{ info: handle.message, parts }], mdl)
          expect(JSON.stringify(modelMsgs)).not.toContain(KiloSessionProcessor.REASONING_LENGTH_WARNING)
        }),
      { git: true },
    ),
  )

  it.effect("adds generic warning when model stops after text length finish", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            { type: "start" },
            { type: "start-step" } as LLM.Event,
            { type: "text-start", id: "text", providerMetadata: undefined } as LLM.Event,
            { type: "text-delta", id: "text", text: "partial answer", providerMetadata: undefined } as LLM.Event,
            { type: "text-end", id: "text", providerMetadata: undefined } as LLM.Event,
            {
              type: "finish-step",
              finishReason: "length",
              usage: usage(),
              providerMetadata: undefined,
            } as LLM.Event,
            { type: "finish" } as LLM.Event,
          )

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

          yield* handle.process(input)
          const parts = MessageV2.parts(msg.id)
          const warning = parts.find(
            (part): part is MessageV2.TextPart =>
              part.type === "text" && part.text === KiloSessionProcessor.OUTPUT_LENGTH_WARNING,
          )

          expect(warning?.ignored).toBe(true)

          const modelMsgs = yield* MessageV2.toModelMessagesEffect([{ info: handle.message, parts }], mdl)
          const json = JSON.stringify(modelMsgs)
          expect(json).toContain("partial answer")
          expect(json).not.toContain(KiloSessionProcessor.OUTPUT_LENGTH_WARNING)
        }),
      { git: true },
    ),
  )

  it.live("ignores deleted session during cost reconciliation", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            { type: "start" },
            { type: "start-step" } as LLM.Event,
            {
              type: "finish-step",
              finishReason: "stop",
              usage: usage(),
              providerMetadata: undefined,
            } as LLM.Event,
            { type: "finish" } as LLM.Event,
          )

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
          yield* session.remove(chat.id)

          const input: LLM.StreamInput = {
            user: parent as MessageV2.User,
            sessionID: chat.id,
            model: mdl,
            agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
            system: [],
            messages: [],
            tools: {},
          }

          const result = yield* handle.process(input)
          expect(result).toBe("continue")
          expect(handle.message.error).toBeUndefined()
        }),
      { git: true },
    ),
  )

  it.live("preserves tool-calls finish when tool parts exist", () =>
    provideTmpdirInstance(
      (dir) =>
        Effect.gen(function* () {
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* test.reply(
            { type: "start" },
            {
              type: "start-step",
            } as LLM.Event,
            { type: "tool-input-start", id: "call_1", toolName: "test_tool" } as LLM.Event,
            {
              type: "finish-step",
              finishReason: "tool-calls",
              usage: usage(),
              providerMetadata: undefined,
            } as LLM.Event,
            { type: "finish" } as LLM.Event,
          )

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

          const result = yield* handle.process(input)
          expect(handle.message.finish).toBe("tool-calls")
          expect(result).toBe("continue")
          const parts = MessageV2.parts(msg.id)
          const tools = parts.filter((p) => p.type === "tool")
          expect(tools.length).toBe(1)
        }),
      { git: true },
    ),
  )
})
