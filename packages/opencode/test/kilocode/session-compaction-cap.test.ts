// Regressions for the compaction cap in SessionPrompt.runLoop.
// Ensures the loop cannot spin forever when every compaction round still
// overflows the model context.

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Env } from "../../src/env"
import { FileTime } from "../../src/file/time"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "../../src/filesystem"
import { Format } from "../../src/format"
import { KiloSession } from "../../src/kilocode/session"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { Log } from "../../src/util/log"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected"),
    authenticate: () => Effect.die("unexpected"),
    finishAuth: () => Effect.die("unexpected"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const filetime = Layer.succeed(
  FileTime.Service,
  FileTime.Service.of({
    read: () => Effect.void,
    get: () => Effect.succeed(undefined),
    assert: () => Effect.void,
    withLock: (_filepath, fn) => fn(),
  }),
)

const plugin = Layer.mock(Plugin.Service)({
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    plugin,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    filetime,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    status,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(Layer.provide(summary), Layer.provideMerge(deps))
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(Layer.provide(summary))
}

const it = testEffect(makeHttp())

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

const overflow = { type: "error", error: { code: "context_length_exceeded" } }

describe("session compaction cap", () => {
  it.live(
    "closes the turn with reason=error after MAX_COMPACTION_ATTEMPTS",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const chat = yield* sessions.create({
            title: "Compaction cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          // Each compaction round = 1 overflow error + 1 summary text.
          // After MAX_COMPACTION_ATTEMPTS rounds the next overflow should
          // trip the cap and break.
          const cap = KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS
          for (let i = 0; i < cap; i++) {
            yield* llm.error(400, overflow)
            yield* llm.text("summary " + i)
          }
          // One more overflow to trip the cap
          yield* llm.error(400, overflow)

          const close = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id) Deferred.doneUnsafe(close, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "please overflow" }],
          })
          yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(close).pipe(Effect.timeout("5 seconds"))
          unsub()

          expect(reason).toBe("error")
        }),
        { git: true, config: providerCfg },
      ),
    30_000,
  )

  it.live(
    "completes normally when compactions stay below the cap",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const bus = yield* Bus.Service
          const chat = yield* sessions.create({
            title: "Compaction under cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          // One compaction round then a successful response
          yield* llm.error(400, overflow)
          yield* llm.text("summary ok")
          yield* llm.text("final answer")

          const close = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id) Deferred.doneUnsafe(close, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "overflow once" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(close).pipe(Effect.timeout("5 seconds"))
          unsub()

          expect(reason).toBe("completed")
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("stop")
          expect(result.parts.some((p) => p.type === "text" && p.text === "final answer")).toBe(true)
        }),
        { git: true, config: providerCfg },
      ),
    15_000,
  )
})
