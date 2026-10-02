// Regressions for the MAX_COMPACTION_ATTEMPTS cap in SessionPrompt.runLoop.
// Ensures the loop cannot spin forever when every compaction round still
// overflows the model context, and that the exhausted turn surfaces as an
// error (rather than silently completing).

import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { describe, expect } from "bun:test"
import { Deferred, Effect, Layer, Schema } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import * as CrossSpawnSpawner from "@opencode-ai/core/cross-spawn-spawner"
import { Env } from "../../src/env"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { KiloSession } from "../../src/kilocode/session"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Question } from "../../src/question"
import { Session } from "../../src/session/session"
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
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
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
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
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

const memoryNode = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const serverNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const root = LayerNode.group([
  SessionPrompt.node,
  SessionCompaction.node,
  Session.node,
  SessionProjector.node,
  MessageV2.node,
  Snapshot.node,
  LLM.node,
  Env.node,
  AgentSvc.node,
  Command.node,
  Permission.node,
  Plugin.node,
  Config.node,
  ProviderSvc.node,
  LSP.node,
  MCP.node,
  FSUtil.node,
  BackgroundJob.node,
  SessionStatus.node,
  SessionRunState.node,
  Database.node,
  EventV2Bridge.node,
  Question.node,
  Todo.node,
  ToolRegistry.node,
  Skill.node,
  Git.node,
  Ripgrep.node,
  Format.node,
  Truncate.node,
  SessionProcessor.node,
  Image.node,
  SessionCompaction.node,
  SessionRevert.node,
  Instruction.node,
  SystemPrompt.node,
  CrossSpawnSpawner.node,
  RuntimeFlags.node,
  memoryNode,
  serverNode,
])

function makeHttp() {
  return LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, RuntimeFlags.layer()],
    [KiloSessions.node, KiloSessions.testLayer],
  ])
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
  for (const scenario of [
    { name: "ordinary overflow", text: "please compact", recovery: false, auto: true, calls: 2 },
    { name: "chunk worker overflow", text: "x".repeat(400_000), recovery: false, auto: true, calls: 1 },
    { name: "successful chunk recovery", text: "please compact", recovery: true, auto: true, calls: 3 },
    { name: "manual recovery with auto disabled", text: "please compact", recovery: true, auto: false, calls: 3 },
  ]) {
    it.live(
      `publishes only terminal errors during ${scenario.name}`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const compaction = yield* SessionCompaction.Service
            const chat = yield* sessions.create({})
            const errors: Array<typeof Session.Event.Error.data.Type> = []
            const off = yield* (yield* EventV2Bridge.Service).listen((evt) => {
              if (evt.type !== Session.Event.Error.type) return Effect.void
              const data = Schema.decodeUnknownSync(Session.Event.Error.data)(evt.data)
              if (data.sessionID === chat.id) errors.push(data)
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)

            yield* llm.error(400, overflowBody)
            if (scenario.recovery) {
              yield* llm.text("partial summary")
              yield* llm.text("recovered summary")
            }
            if (!scenario.recovery && scenario.calls === 2) yield* llm.error(400, overflowBody)
            const user = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model: ref,
              noReply: true,
              parts: [{ type: "text", text: scenario.text }],
            })
            const result = yield* compaction.process({
              sessionID: chat.id,
              parentID: user.info.id,
              messages: yield* sessions.messages({ sessionID: chat.id }),
              auto: false,
            })
            expect(yield* llm.calls).toBe(scenario.calls)
            expect(result).toBe(scenario.recovery ? "continue" : "stop")
            const history = yield* sessions.messages({ sessionID: chat.id })
            expect(history.some((msg) => msg.info.id === user.info.id)).toBe(true)
            const summary = history.find((msg) => msg.info.role === "assistant" && msg.info.summary)
            expect(summary?.info.role).toBe("assistant")
            if (summary?.info.role !== "assistant") return
            if (scenario.recovery) {
              expect(errors).toEqual([])
              expect(summary.info.error).toBeUndefined()
              expect(summary.parts.some((part) => part.type === "text" && part.text === "recovered summary")).toBe(true)
              return
            }
            expect(summary.info.error?.name).toBe("ContextOverflowError")
            expect(errors).toEqual([{ sessionID: chat.id, error: summary.info.error }])
            expect(JSON.stringify(summary.info.error)).toContain("Start a new session")
          }),
          { git: true, config: (url) => ({ ...providerCfg(url), compaction: { auto: scenario.auto } }) },
        ),
      30_000,
    )
  }

  for (const scenario of [
    { name: "automatic", auto: true, text: "please overflow", blank: "" },
    { name: "chunked", auto: true, text: "x".repeat(400_000), blank: "" },
    { name: "manual", auto: false, text: "please compact", blank: "" },
    { name: "whitespace", auto: true, text: "please overflow", blank: " \n " },
  ]) {
    it.live(
      `surfaces ${scenario.name} empty compaction and stops without losing history`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const compaction = yield* SessionCompaction.Service
            const events = yield* EventV2Bridge.Service
            const chat = yield* sessions.create({
              permission: [{ permission: "*", pattern: "*", action: "allow" }],
            })
            const errors: Array<typeof Session.Event.Error.data.Type> = []
            const off = yield* events.listen((evt) => {
              if (evt.type !== Session.Event.Error.type) return Effect.void
              const data = evt.data as typeof Session.Event.Error.data.Type
              if (data.sessionID === chat.id && data.error?.name === "APIError") errors.push(data)
              return Effect.void
            })
            yield* Effect.addFinalizer(() => off)
            const closed = yield* Deferred.make<KiloSession.CloseReason>()
            const unsub = Bus.subscribe(KiloSession.Event.TurnClose, (evt) => {
              if (evt.properties.sessionID === chat.id)
                Deferred.doneUnsafe(closed, Effect.succeed(evt.properties.reason))
            })
            yield* Effect.addFinalizer(() => Effect.sync(unsub))

            if (scenario.auto) yield* llm.error(400, overflowBody)
            yield* llm.push(reply().text(scenario.blank).finish("stop").usage({ input: 0, output: 0 }))
            const user = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              noReply: true,
              parts: [{ type: "text", text: scenario.text }],
            })
            if (!scenario.auto) yield* compaction.create({ sessionID: chat.id, agent: "code", model: ref, auto: false })

            const result = yield* prompt.loop({ sessionID: chat.id })
            expect(yield* Deferred.await(closed).pipe(Effect.timeout("2 seconds"))).toBe("error")
            expect(yield* llm.calls).toBe(scenario.auto ? 2 : 1)
            expect(yield* (yield* SessionStatus.Service).get(chat.id)).toEqual({ type: "idle" })
            expect(errors).toHaveLength(1)
            expect(errors.at(0)?.error).toEqual(result.info.role === "assistant" ? result.info.error : undefined)
            expect(result.info.role).toBe("assistant")
            if (result.info.role !== "assistant") return
            expect(result.info.finish).toBe("error")
            expect(result.info.error?.name).toBe("APIError")
            if (result.info.error?.name !== "APIError") return
            expect(result.info.error.data.message).toContain("empty summary")
            expect(result.info.error.data.message).toContain("start a new session")
            const history = yield* sessions.messages({ sessionID: chat.id })
            expect(history.some((msg) => msg.info.id === user.info.id)).toBe(true)
            expect(
              MessageV2.filterCompacted(yield* MessageV2.stream(chat.id)).some((msg) => msg.info.id === user.info.id),
            ).toBe(true)
            expect(history.filter((msg) => msg.info.role === "assistant" && msg.info.summary)).toHaveLength(1)
            expect(
              history.flatMap((msg) => msg.parts).some((part) => part.type === "compaction" && part.tail_start_id),
            ).toBe(false)
          }),
          { git: true, config: providerCfg },
        ),
      30_000,
    )
  }

  it.live(
    "closes the turn with reason=error after MAX_COMPACTION_ATTEMPTS compactions",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
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

          const errors: Array<typeof Session.Event.Error.data.Type> = []
          const off = yield* (yield* EventV2Bridge.Service).listen((evt) => {
            if (evt.type !== Session.Event.Error.type) return Effect.void
            const data = evt.data as typeof Session.Event.Error.data.Type
            if (
              data.sessionID === chat.id &&
              data.error?.name === "ContextOverflowError" &&
              data.error.data.message.startsWith("Compaction exhausted")
            )
              errors.push(data)
            return Effect.void
          })
          yield* Effect.addFinalizer(() => off)

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = Bus.subscribe(KiloSession.Event.TurnClose, (evt) => {
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
          expect(result.info.error.data.message).toContain("Start a new session")
          expect(errors).toEqual([{ sessionID: chat.id, error: result.info.error }])
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
          const chat = yield* sessions.create({
            title: "Compaction under cap",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.error(400, overflowBody) // 1 — one compaction attempt
          yield* llm.text("summary ok") // 2 — summary succeeds
          yield* llm.text("final answer") // 3 — replayed turn completes

          const turnClose = yield* Deferred.make<KiloSession.CloseReason>()
          const unsub = Bus.subscribe(KiloSession.Event.TurnClose, (evt) => {
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
