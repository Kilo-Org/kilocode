// Set env before any imports that transitively load flag.ts (e.g. LLM, SessionRetry).
// This MUST happen before static imports, but ES module imports are hoisted.
// So we set it here and use mock.module + dynamic imports for modules that
// transitively load flag.ts to ensure the env is captured at load time.
process.env.KILO_SESSION_RETRY_LIMIT = "2"

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, describe, expect, spyOn } from "bun:test"
import { APICallError } from "ai"
import { Context, Effect, Exit, Layer, Schedule } from "effect"
import * as Stream from "effect/Stream"
import type { LLMEvent } from "@opencode-ai/llm"
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

class State extends Context.Service<State, { readonly queue: Script[]; calls: number }>()("@test/RetryLimitLLMState") {}

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

function retryable429(headers?: Record<string, string>) {
  return new APICallError({
    message: "429 status code (no body)",
    url: "https://api.openai.com/v1/chat/completions",
    requestBodyValues: {},
    statusCode: 429,
    responseHeaders: headers ?? { "content-type": "application/json" },
    isRetryable: true,
  })
}

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
      return TestLLM.of({
        push: (item) => Effect.sync(() => state.queue.push(item)).pipe(Effect.asVoid),
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
]).pipe(Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, Bus.layer, SyncEvent.defaultLayer)))

const it = testEffect(env)

afterEach(() => {
  delete process.env.KILO_SESSION_RETRY_LIMIT
})

describe("session processor retry limit", () => {
  const run = (limit: number) =>
    provideTmpdirProject(
      (dir) =>
        Effect.gen(function* () {
          process.env.KILO_SESSION_RETRY_LIMIT = String(limit)
          const test = yield* TestLLM
          const processors = yield* SessionProcessor.Service
          const session = yield* Session.Service

          yield* Effect.forEach(Array.from({ length: limit + 1 }), () => test.push(Stream.fail(retryable429())), {
            discard: true,
          })
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
            expect(calls).toBe(limit + 1)
            expect(handle.message.error).toStrictEqual(expected)
          } finally {
            delay.mockRestore()
          }
        }),
      { git: true },
    )

  it.live("stops after two retries with the normalized retryable error", () => run(2), 15000)

  it.live("honors a configured retry limit above the upstream default", () => run(10), 15000)

  const policy = (items: ("offline" | "provider")[], limit?: number) =>
    Effect.gen(function* () {
      const attempts: number[] = []
      const state = { offline: 0, stopped: false }
      const step = yield* Schedule.toStepWithMetadata(
        SessionRetry.policy({
          provider: "test",
          limit,
          parse: (error) => MessageV2.fromError(error, { providerID: ref.providerID }),
          set: (info) => Effect.sync(() => attempts.push(info.attempt)).pipe(Effect.asVoid),
          offline: () =>
            Effect.sync(() => {
              state.offline += 1
              return "retry" as const
            }),
        }),
      )

      for (const item of items) {
        const result = yield* Effect.exit(
          step(item === "offline" ? new Error("fetch failed") : retryable429({ "retry-after-ms": "0" })),
        )
        if (Exit.isFailure(result)) {
          state.stopped = true
          break
        }
      }

      return { attempts, ...state }
    })

  it.effect("recovers beyond the default cap without consuming provider retries", () =>
    Effect.gen(function* () {
      const result = yield* policy([...Array.from({ length: 6 }, () => "offline" as const), "provider"])
      expect(result.offline).toBe(6)
      expect(result.attempts).toEqual([0, 0, 0, 0, 0, 0, 1])
      expect(result.stopped).toBe(false)
    }),
  )

  it.effect("preserves the upstream provider cap across mixed reconnects", () =>
    Effect.gen(function* () {
      const result = yield* policy(Array.from({ length: 6 }, () => ["provider", "offline"] as const).flat())
      expect(result.offline).toBe(5)
      expect(result.attempts).toEqual([1, 0, 2, 0, 3, 0, 4, 0, 5, 0])
      expect(result.stopped).toBe(true)
    }),
  )

  it.effect("preserves explicit raw attempt limits before reconnect handlers", () =>
    Effect.gen(function* () {
      const result = yield* policy(["offline", "provider", "offline", "provider", "offline", "offline"], 5)
      expect(result.offline).toBe(3)
      expect(result.attempts).toEqual([0, 2, 0, 4, 0])
      expect(result.stopped).toBe(true)
    }),
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
