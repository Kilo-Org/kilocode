// Regressions for the MAX_COMPACTION_ATTEMPTS cap in SessionPrompt.runLoop.
// Ensures the loop cannot spin forever when every compaction round still
// overflows the model context, and that the exhausted turn surfaces as an
// error (rather than silently completing).

import { NodeFileSystem } from "@effect/platform-node"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config"
import * as CrossSpawnSpawner from "../../src/effect/cross-spawn-spawner"
import { Env } from "../../src/env"
import { Ripgrep } from "../../src/file/ripgrep"
import { AppFileSystem } from "@opencode-ai/shared/filesystem"
import { Format } from "../../src/format"
import { KiloSession } from "../../src/kilocode/session"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { LSP } from "../../src/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Session } from "../../src/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry, Truncate } from "../../src/tool"
import { Log } from "../../src/util"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const ref = {
  providerID: ProviderID.make("test"),
  modelID: ModelID.make("test-model"),
}

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

// Pass-through plugin mock. Lets every plugin trigger proceed with its default
// output so compaction's `experimental.compaction.autocontinue` stays on (the
// "compact" result path uses replay mode and the loop re-enters without the
// synthetic continue prompt anyway).
const plugin = Layer.mock(Plugin.Service)({
  trigger: <Name extends string, Input, Output>(_name: Name, _input: Input, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

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
    startAuth: () => Effect.die("unexpected MCP auth in compaction cap tests"),
    authenticate: () => Effect.die("unexpected MCP auth in compaction cap tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in compaction cap tests"),
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

const status = SessionStatus.layer.pipe(Layer.provideMerge(Bus.layer))
const runState = SessionRunState.layer.pipe(Layer.provide(status))
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
      Layer.provideMerge(runState),
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

const overflowBody = { type: "error", error: { code: "context_length_exceeded" } }

describe("session compaction cap", () => {
  it.live(
    "closes the turn with reason=error after MAX_COMPACTION_ATTEMPTS compactions",
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

          // Interleave overflow errors (top-level LLM call) and successful
          // summary texts (compaction.process internal LLM call) so each
          // compaction round completes and the loop re-enters. With
          // MAX_COMPACTION_ATTEMPTS = 3 we queue 4 errors + 3 texts = 7 calls.
          // The final error triggers guardCompactionAttempt and breaks.
          yield* llm.error(400, overflowBody) // 1 — top-level fails → attempt 1
          yield* llm.text("summary 1") // 2 — compaction summary succeeds
          yield* llm.error(400, overflowBody) // 3 — post-replay fails → attempt 2
          yield* llm.text("summary 2") // 4
          yield* llm.error(400, overflowBody) // 5 — attempt 3
          yield* llm.text("summary 3") // 6
          yield* llm.error(400, overflowBody) // 7 — exhausts, breaks

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id)
              Deferred.doneUnsafe(turnClose, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "please overflow" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(turnClose).pipe(Effect.timeout("2 seconds"))
          unsub()

          // Each compaction round costs 2 LLM calls in this replay-mode path (one
          // top-level overflow + one summary) plus 1 final overflow that trips the cap.
          expect(yield* llm.calls).toBe(KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS * 2 + 1)
          expect(reason).toBe("error")
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("error")
          expect(result.info.error?.name).toBe("ContextOverflowError")
          if (result.info.error?.name !== "ContextOverflowError") return
          expect(result.info.error.data.message).toContain("Compaction exhausted")
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

          yield* llm.error(400, overflowBody) // 1 — one compaction attempt
          yield* llm.text("summary ok") // 2 — summary succeeds
          yield* llm.text("final answer") // 3 — replayed turn completes

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = yield* bus.subscribeCallback(KiloSession.Event.TurnClose, (evt) => {
            if (evt.properties.sessionID === chat.id)
              Deferred.doneUnsafe(turnClose, Effect.succeed(evt.properties.reason))
          })

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            noReply: true,
            parts: [{ type: "text", text: "overflow once" }],
          })
          const result = yield* prompt.loop({ sessionID: chat.id })
          const reason = yield* Deferred.await(turnClose).pipe(Effect.timeout("2 seconds"))
          unsub()

          expect(yield* llm.calls).toBe(3)
          expect(reason).toBe("completed")
          expect(result.info.role).toBe("assistant")
          if (result.info.role !== "assistant") return
          expect(result.info.finish).toBe("stop")
          expect(result.info.error).toBeUndefined()
          expect(result.parts.some((p) => p.type === "text" && p.text === "final answer")).toBe(true)
        }),
        { git: true, config: providerCfg },
      ),
    15_000,
  )
})

function makeAssistantStub(sessionID: string): MessageV2.Assistant {
  return {
    id: MessageID.ascending(),
    role: "assistant",
    sessionID: SessionID.make(sessionID),
    parentID: MessageID.ascending(),
    mode: "code",
    agent: "code",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
  }
}

describe("KiloSessionPrompt.guardCompactionAttempt", () => {
  it.effect("returns { exhausted: false } and does not mutate state below the cap", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const msg = makeAssistantStub("ses_under")
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_under",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS - 1,
        closeReasons,
        message: msg,
      })
      expect(result.exhausted).toBe(false)
      expect(closeReasons.has("ses_under")).toBe(false)
      expect(msg.error).toBeUndefined()
      expect(msg.finish).toBeUndefined()
    }),
  )

  it.effect("sets close reason and attaches error once attempts reach the cap", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const msg = makeAssistantStub("ses_cap")
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_cap",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
        closeReasons,
        message: msg,
      })
      expect(result.exhausted).toBe(true)
      if (!result.exhausted) return
      expect(closeReasons.get("ses_cap")).toBe("error")
      expect(msg.error?.name).toBe("ContextOverflowError")
      if (msg.error?.name !== "ContextOverflowError") return
      expect(msg.error.data.message).toContain("Compaction exhausted")
      expect(msg.finish).toBe("error")
      expect(result.error.name).toBe("ContextOverflowError")
    }),
  )

  it.effect("works without a message and still sets the close reason", () =>
    Effect.sync(() => {
      const closeReasons = new Map<string, KiloSession.CloseReason>()
      const result = KiloSessionPrompt.guardCompactionAttempt({
        sessionID: "ses_no_msg",
        attempts: KiloSessionPrompt.MAX_COMPACTION_ATTEMPTS,
        closeReasons,
      })
      expect(result.exhausted).toBe(true)
      expect(closeReasons.get("ses_no_msg")).toBe("error")
    }),
  )
})
