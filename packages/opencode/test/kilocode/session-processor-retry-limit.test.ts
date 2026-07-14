// Set env before any imports that transitively load flag.ts (e.g. LLM, SessionRetry).
// This MUST happen before static imports, but ES module imports are hoisted.
// So we set it here and use mock.module + dynamic imports for modules that
// transitively load flag.ts to ensure the env is captured at load time.
process.env.KILO_SESSION_RETRY_LIMIT = "2"

import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, describe, expect, spyOn } from "bun:test"
import { APICallError } from "ai"
import { Context, Effect, Layer } from "effect"
import * as Stream from "effect/Stream"
import { LLMEvent } from "@opencode-ai/llm"
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
import { Reference } from "../../src/reference/reference"
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

type Script = Stream.Stream<LLMEvent, unknown>

class TestLLM extends Context.Service<
  TestLLM,
  {
    readonly push: (stream: Script) => Effect.Effect<void>
    readonly calls: Effect.Effect<number>
  }
>()("@test/RetryLimitLLM") {}

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

function retryable429() {
  return new APICallError({
    message: "429 status code (no body)",
    url: "https://api.openai.com/v1/chat/completions",
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
    const push = (item: Script) => {
      queue.push(item)
      return Effect.void
    }
    return Layer.mergeAll(
      Layer.succeed(
        LLM.Service,
        LLM.Service.of({
          stream: () => {
            calls += 1
            const item = queue.shift() ?? Stream.fail(new Error("unexpected extra llm call"))
            return item
          },
        }),
      ),
      Layer.succeed(TestLLM, TestLLM.of({ push, calls: Effect.sync(() => calls) })),
    )
  }),
)

const reference = Layer.mock(Reference.Service)({
  init: () => Effect.void,
  list: () => Effect.succeed([]),
  get: () => Effect.succeed(undefined),
  ensure: () => Effect.void,
  contains: () => Effect.succeed(false),
})
const status = Layer.mergeAll(SessionStatus.defaultLayer, Bus.layer)
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)
const deps = Layer.mergeAll(
  Session.defaultLayer,
  Snapshot.defaultLayer,
  AgentSvc.defaultLayer,
  Permission.defaultLayer,
  Plugin.defaultLayer,
  Config.defaultLayer,
  RuntimeFlags.layer(),
  reference,
  SessionSummary.defaultLayer,
  Image.defaultLayer,
  SyncEvent.defaultLayer,
  EventV2Bridge.defaultLayer,
  Database.defaultLayer,
  status,
  llm,
).pipe(Layer.provideMerge(infra))
const env = SessionProcessor.layer.pipe(Layer.provideMerge(deps), Layer.provide(reference))

const it = testEffect(env)

afterEach(() => {
  delete process.env.KILO_SESSION_RETRY_LIMIT
})

describe("session processor retry limit", () => {
  it.live(
    "retries empty responses but not terminal or partial responses",
    () =>
      provideTmpdirProject(
        (dir) =>
          Effect.gen(function* () {
            process.env.KILO_SESSION_RETRY_LIMIT = "2"
            const test = yield* TestLLM
            const processors = yield* SessionProcessor.Service
            const session = yield* Session.Service

            const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)
            const mdl = model()
            const setup = Effect.fn(function* () {
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
              const handle = yield* processors.create({ assistantMessage: msg, sessionID: chat.id, model: mdl })
              return {
                handle,
                input: {
                  user: parent as MessageV2.User,
                  sessionID: chat.id,
                  model: mdl,
                  agent: { name: "code", mode: "primary", permission: [], options: {} } as any,
                  system: [],
                  messages: [],
                  tools: {},
                } satisfies LLM.StreamInput,
              }
            })

            try {
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              const empty = yield* setup()
              expect(yield* empty.handle.process(empty.input)).toBe("stop")
              expect(yield* test.calls).toBe(4)
              expect(empty.handle.message.finish).toBe("unknown")
              expect(empty.handle.message.error).toMatchObject({
                data: { message: "Response ended without a finish reason and may be incomplete." },
              })

              yield* test.push(
                Stream.make(
                  LLMEvent.stepFinish({ index: 0, reason: "unknown" }),
                  LLMEvent.finish({ reason: "unknown" }),
                ),
              )
              const terminal = yield* setup()
              expect(yield* terminal.handle.process(terminal.input)).toBe("continue")
              expect(yield* test.calls).toBe(5)
              expect(terminal.handle.message.finish).toBe("unknown")
              expect(terminal.handle.message.error).toBeUndefined()

              yield* test.push(
                Stream.make(
                  LLMEvent.textStart({ id: "text" }),
                  LLMEvent.textDelta({ id: "text", text: "partial" }),
                  LLMEvent.textEnd({ id: "text" }),
                ),
              )
              const partial = yield* setup()
              expect(yield* partial.handle.process(partial.input)).toBe("continue")
              expect(yield* test.calls).toBe(6)
              expect(partial.handle.message.finish).toBe("unknown")
              expect(partial.handle.message.error).toBeUndefined()
              expect(yield* MessageV2.parts(partial.handle.message.id)).toContainEqual(
                expect.objectContaining({ type: "text", text: "partial" }),
              )

              yield* test.push(Stream.make(LLMEvent.toolCall({ id: "call", name: "write", input: {} })))
              const tool = yield* setup()
              expect(yield* tool.handle.process(tool.input)).toBe("continue")
              expect(yield* test.calls).toBe(7)
              expect(tool.handle.message.finish).toBe("unknown")
              expect(tool.handle.message.error).toBeUndefined()
              expect(yield* MessageV2.parts(tool.handle.message.id)).toContainEqual(
                expect.objectContaining({ type: "tool", tool: "write" }),
              )

              yield* test.push(
                Stream.make(LLMEvent.textStart({ id: "empty" }), LLMEvent.textEnd({ id: "empty" })),
              )
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              yield* test.push(Stream.make(LLMEvent.stepStart({ index: 0 })))
              expect(yield* tool.handle.process(tool.input)).toBe("stop")
              expect(yield* test.calls).toBe(11)
              expect(tool.handle.message.error).toMatchObject({
                data: { message: "Response ended without a finish reason and may be incomplete." },
              })
            } finally {
              delay.mockRestore()
            }
          }),
        { git: true },
      ),
    15000,
  )

  it.live(
    "stops after two retries with the normalized retryable error",
    () =>
      provideTmpdirProject(
        (dir) =>
          Effect.gen(function* () {
            process.env.KILO_SESSION_RETRY_LIMIT = "2"
            const test = yield* TestLLM
            const processors = yield* SessionProcessor.Service
            const session = yield* Session.Service

            // 3 retryable 429 errors + sentinel (should not be reached)
            yield* test.push(Stream.fail(retryable429()))
            yield* test.push(Stream.fail(retryable429()))
            yield* test.push(Stream.fail(retryable429()))
            yield* test.push(Stream.fail(new Error("unexpected extra llm call")))

            const delay = spyOn(SessionRetry, "delay").mockReturnValue(0)

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

            const expected = MessageV2.fromError(retryable429(), { providerID: ProviderV2.ID.make("test") })
            try {
              const result = yield* handle.process(input)
              const calls = yield* test.calls

              expect(result).toBe("stop")
              expect(calls).toBe(3)
              expect(handle.message.error).toStrictEqual(expected)
            } finally {
              delay.mockRestore()
            }
          }),
        { git: true },
      ),
    15000,
  )

  it.effect("only positive integers enable the limit", () =>
    Effect.promise(async () => {
      const { Flag } = await import("@opencode-ai/core/flag/flag")

      delete process.env.KILO_SESSION_RETRY_LIMIT
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

      process.env.KILO_SESSION_RETRY_LIMIT = "0"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

      process.env.KILO_SESSION_RETRY_LIMIT = "-1"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

      process.env.KILO_SESSION_RETRY_LIMIT = "abc"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()

      process.env.KILO_SESSION_RETRY_LIMIT = "2"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBe(2)
    }),
  )

  it.effect("reads env at access time (dynamic getter)", () =>
    Effect.promise(async () => {
      const { Flag } = await import("@opencode-ai/core/flag/flag")
      delete process.env.KILO_SESSION_RETRY_LIMIT
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()
      process.env.KILO_SESSION_RETRY_LIMIT = "5"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBe(5)
      delete process.env.KILO_SESSION_RETRY_LIMIT
    }),
  )
})
