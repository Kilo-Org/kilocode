// Regression for the bounded automatic restart of stuck MAIN (root) sessions.
// Drives the real SessionPrompt.prompt/loop path (NOT SessionProcessor.process),
// so the turn-level restart loop is actually exercised. Layer-A in-turn stream
// retry is bounded to a single retry (KILO_SESSION_RETRY_LIMIT=1), so each stuck turn
// terminates after exactly 2 LLM calls (1 initial + 1 layer-A retry) and the coarser
// turn-level restart re-runs the whole turn.
process.env.KILO_SESSION_RETRY_LIMIT = "1"

import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, describe, expect, spyOn } from "bun:test"
import { Deferred, Effect, Exit, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { Database } from "@opencode-ai/core/database/database"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Auth } from "../../src/auth"
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
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { Question } from "../../src/question"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Session } from "../../src/session/session"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRetry } from "../../src/session/retry"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloSession } from "@/kilocode/session"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import * as Log from "@opencode-ai/core/util/log"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

Log.init({ print: false })

let delaySpy: { mockRestore(): void } | undefined

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
    startAuth: () => Effect.die("unexpected MCP auth in restart-limit tests"),
    authenticate: () => Effect.die("unexpected MCP auth in restart-limit tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in restart-limit tests"),
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

const status = Layer.mergeAll(SessionStatus.defaultLayer, Bus.layer)
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    BackgroundJob.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    plugin,
    Config.defaultLayer,
    mcp,
    ProviderSvc.defaultLayer,
    lsp,
    FSUtil.defaultLayer,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
    Database.defaultLayer,
    status,
    MemoryService.layer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Auth.defaultLayer),
    Layer.provide(KiloSessions.testLayer),
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provideMerge(question),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        summary,
        deps,
        Config.defaultLayer,
        RuntimeFlags.layer(),
        BackgroundJob.defaultLayer,
        Bus.layer,
        infra,
        Storage.defaultLayer,
      ),
    ),
  )
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

const serverError = { error: { message: "internal server error" } }
const badRequest = { error: { message: "bad request" } }

const user = Effect.fn("restart-limit.user")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "code",
    model: ref,
    time: { created: Date.now() },
    tools: {},
  } satisfies MessageV2.User)
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  } satisfies MessageV2.TextPart)
  return msg
})

const errorOf = (m: MessageV2.WithParts) => (m.info.role === "assistant" ? m.info.error : undefined)

afterEach(() => {
  delaySpy?.mockRestore()
  delaySpy = undefined
  delete process.env.KILO_MAIN_SESSION_RESTART_LIMIT
  delete process.env.KILO_SESSION_RETRY_LIMIT
})

describe("session main restart limit", () => {
  it.live(
    "restarts a stuck root session and recovers on a retryable error",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          process.env.KILO_MAIN_SESSION_RESTART_LIMIT = "3"
          delaySpy = spyOn(SessionRetry, "delay").mockReturnValue(0)
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const closes: KiloSession.CloseReason[] = []
          const off = Bus.subscribe(KiloSession.Event.TurnClose, (event) => {
            if (event.properties.sessionID) closes.push(event.properties.reason)
          })

          const chat = yield* sessions.create({
            title: "Stuck main recover",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          expect(chat.parentID).toBeUndefined()

          yield* llm.error(500, serverError) // turn 1: initial call
          yield* llm.error(500, serverError) // turn 1: layer-A retry -> turn terminates retryable
          yield* llm.text("recovered") // turn-level restart re-drives the turn and succeeds

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "do the thing" }],
          })
          off()

          // 1 failed turn (2 calls) + 1 successful turn-level restart (1 call)
          expect(yield* llm.calls).toBe(3)
          expect(result.info.role).toBe("assistant")
          expect(errorOf(result)).toBeUndefined()
          expect(result.parts.some((p) => p.type === "text" && p.text === "recovered")).toBe(true)

          // exactly one completed assistant answering the user turn (no duplicate/orphan)
          const msgs = yield* sessions.messages({ sessionID: chat.id })
          const assistants = msgs.filter((m) => m.info.role === "assistant")
          expect(assistants).toHaveLength(1)
          expect(assistants[0]?.info.id).toBe(result.info.id)

          // coalesced: exactly one TurnClose for the user turn, and it is "completed"
          expect(closes).toEqual(["completed"])
        }),
        { git: true, config: providerCfg },
      ),
    30000,
  )

  it.live(
    "stops with a terminal error after the restart limit is exhausted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          process.env.KILO_MAIN_SESSION_RESTART_LIMIT = "2"
          delaySpy = spyOn(SessionRetry, "delay").mockReturnValue(0)
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const closes: KiloSession.CloseReason[] = []
          const off = Bus.subscribe(KiloSession.Event.TurnClose, (event) => {
            if (event.properties.sessionID) closes.push(event.properties.reason)
          })

          const chat = yield* sessions.create({
            title: "Stuck main exhaust",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          // Always fail retryably. Each stuck turn = 2 calls (initial + 1 layer-A retry).
          // With restart limit 2: 1 initial turn + 2 restarts = 3 turns = 6 calls, then a
          // terminal error (no infinite loop). Queue exactly 6; a 7th call (over-run) would
          // fail with "unexpected extra llm call" and make this assertion fail loudly.
          for (let i = 0; i < 6; i++) yield* llm.error(500, serverError)

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "keep failing" }],
          })
          off()

          expect(yield* llm.calls).toBe(6)
          expect(result.info.role).toBe("assistant")
          const surfaced = errorOf(result)
          expect(surfaced).toBeDefined()
          // The exhaustion signal must be clearly surfaced (Finding #1: a clear,
          // non-retryable "restart limit exhausted" message), not the underlying
          // retryable error from the last failed attempt.
          const message = (surfaced as { data?: { message?: string } } | undefined)?.data?.message
          expect(typeof message).toBe("string")
          expect(message).toMatch(/restart limit .*exhausted/i)

          const msgs = yield* sessions.messages({ sessionID: chat.id })
          const lastAssistant = msgs.filter((m) => m.info.role === "assistant").at(-1)
          expect(lastAssistant?.info.id).toBe(result.info.id)
          expect(result.parts).toEqual(lastAssistant?.parts ?? [])

          // coalesced: exactly one TurnClose, reason error
          expect(closes).toEqual(["error"])
        }),
        { git: true, config: providerCfg },
      ),
    30000,
  )

  it.live(
    "does not restart on a non-retryable error",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          process.env.KILO_MAIN_SESSION_RESTART_LIMIT = "3"
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const chat = yield* sessions.create({
            title: "Stuck main non-retryable",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })

          yield* llm.error(400, badRequest) // non-retryable: no layer-A retry, no turn-level restart
          yield* llm.error(400, badRequest) // guard: must not be consumed

          const result = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            parts: [{ type: "text", text: "bad" }],
          })

          expect(yield* llm.calls).toBe(1) // no restart
          expect(result.info.role).toBe("assistant")
          expect(errorOf(result)).toBeDefined()

          const msgs = yield* sessions.messages({ sessionID: chat.id })
          const lastAssistant = msgs.filter((m) => m.info.role === "assistant").at(-1)
          expect(lastAssistant?.info.id).toBe(result.info.id)
          expect(result.parts).toEqual(lastAssistant?.parts ?? [])
        }),
        { git: true, config: providerCfg },
      ),
    30000,
  )

  it.live(
    "does not auto-restart a subagent (child) session",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          process.env.KILO_MAIN_SESSION_RESTART_LIMIT = "3"
          delaySpy = spyOn(SessionRetry, "delay").mockReturnValue(0)
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const parent = yield* sessions.create({
            title: "Parent",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          const child = yield* sessions.create({
            parentID: parent.id,
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          expect(child.parentID).toBe(parent.id)

          // retryable errors, but a subagent must NOT auto-restart (parent-driven only).
          // The turn still exhausts layer-A (2 calls) before terminating; there is no
          // turn-level restart, so exactly 2 calls and no more.
          for (let i = 0; i < 4; i++) yield* llm.error(500, serverError)

          const result = yield* prompt.prompt({
            sessionID: child.id,
            agent: "code",
            parts: [{ type: "text", text: "child fails" }],
          })

          expect(yield* llm.calls).toBe(2) // 1 initial + 1 layer-A retry; no turn-level restart
          expect(errorOf(result)).toBeDefined()
        }),
        { git: true, config: providerCfg },
      ),
    30000,
  )

  it.live(
    "does not restart when the user cancels the turn",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          process.env.KILO_SESSION_RETRY_LIMIT = "1"
          process.env.KILO_MAIN_SESSION_RESTART_LIMIT = "3"
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service

          const closes: KiloSession.CloseReason[] = []
          const offClose = Bus.subscribe(KiloSession.Event.TurnClose, (event) => {
            if (event.properties.sessionID) closes.push(event.properties.reason)
          })
          const opened = yield* Deferred.make<void>()
          const offOpen = Bus.subscribe(KiloSession.Event.TurnOpen, (event) => {
            if (event.properties.sessionID) Effect.runFork(Deferred.succeed(opened, undefined))
          })

          const chat = yield* sessions.create({
            title: "Stuck main cancel",
            permission: [{ permission: "*", pattern: "*", action: "allow" }],
          })
          yield* user(chat.id, "please hang")
          yield* llm.push(reply().hang()) // turn hangs until cancelled

          const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
          yield* Deferred.await(opened)
          yield* Effect.yieldNow
          yield* prompt.cancel(chat.id)
          const exit = yield* Fiber.await(fiber)
          offClose()
          offOpen()

          expect(Exit.isSuccess(exit)).toBe(true)
          // a cancelled turn is not "stuck"; it must not trigger any restart (<=1 call, no re-drive)
          expect(yield* llm.calls).toBeLessThanOrEqual(1)
          expect(closes).toEqual(["completed"])
        }),
        { git: true, config: providerCfg },
      ),
    30000,
  )
})
