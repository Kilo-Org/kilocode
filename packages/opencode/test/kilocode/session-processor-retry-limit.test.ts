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
import { SessionRetry } from "../../src/session/retry"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionSummary } from "../../src/session/summary"
import { Snapshot } from "../../src/snapshot"
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
          raw: () => Effect.die("raw not implemented in TestLLM"),
        }),
      ),
      Layer.succeed(TestLLM, TestLLM.of({ push, calls: Effect.sync(() => calls) })),
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

afterEach(() => {
  delete process.env.KILO_SESSION_RETRY_LIMIT
})

describe("session processor retry limit", () => {
  it.live(
    "stops after two retries with the normalized retryable error",
    () =>
      provideTmpdirInstance(
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

            const expected = MessageV2.fromError(retryable429(), { providerID: ProviderID.make("test") })
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
      const { Flag } = await import("../../src/flag/flag")

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
      const { Flag } = await import("../../src/flag/flag")
      delete process.env.KILO_SESSION_RETRY_LIMIT
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBeUndefined()
      process.env.KILO_SESSION_RETRY_LIMIT = "5"
      expect(Flag.KILO_SESSION_RETRY_LIMIT).toBe(5)
      delete process.env.KILO_SESSION_RETRY_LIMIT
    }),
  )
})
