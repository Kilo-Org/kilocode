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
import { KiloCompactionChunks } from "../../src/kilocode/session/compaction-chunks"
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
import { provideTmpdirProject, provideTmpdirServer } from "../fixture/fixture"
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
    remove: () => Effect.void, // kilocode_change
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in compaction cap tests"),
    authenticate: () => Effect.die("unexpected MCP auth in compaction cap tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in compaction cap tests"),
    removeAuth: () => Effect.void,
    cancelAuth: () => Effect.void,
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

function makeHttp(outputTokenMax?: number, failure = false) {
  const replacements = [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [RuntimeFlags.node, RuntimeFlags.layer({ outputTokenMax })],
    [KiloSessions.node, KiloSessions.testLayer],
  ] as const
  if (!failure) return LayerNode.compile(root, replacements)

  // Reuse the real HTTP handle for a provider failure after length, including halt's error event.
  const processor = Layer.effect(
    SessionProcessor.Service,
    Effect.gen(function* () {
      const real = yield* SessionProcessor.Service
      return SessionProcessor.Service.of({
        create: (input) =>
          real.create(input).pipe(
            Effect.map((handle) => ({
              ...handle,
              process: (stream) =>
                Effect.gen(function* () {
                  const result = yield* handle.process(stream)
                  if (handle.message.finish !== "length") return result
                  return yield* handle.process(stream)
                }),
            })),
          ),
      })
    }),
  ).pipe(Layer.provide(LayerNode.compile(SessionProcessor.node, replacements)))
  return LayerNode.compile(root, [...replacements, [SessionProcessor.node, processor]])
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
  testEffect(makeHttp(undefined, true)).live(
    "preserves the provider error after a single-pass length finish",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
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
          yield* llm.push(reply().text("unfinished sentence").finish("length"))
          yield* llm.error(400, { error: { message: "provider failure after length" } })
          const user = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model: ref,
            noReply: true,
            parts: [{ type: "text", text: "preserve this history" }],
          })
          yield* compaction.create({ sessionID: chat.id, agent: "code", model: ref, auto: false })
          const messages = yield* sessions.messages({ sessionID: chat.id })
          const result = yield* compaction.process({
            sessionID: chat.id,
            parentID: messages.at(-1)!.info.id,
            messages,
            auto: false,
          })
          expect(yield* llm.calls).toBe(2)
          const requests = yield* llm.inputs
          expect(JSON.stringify(requests.at(0))).toContain("Create a new anchored summary")
          expect(JSON.stringify(requests.at(0))).not.toContain("Summarize conversation chunk")
          const history = yield* sessions.messages({ sessionID: chat.id })
          expect(history.some((msg) => msg.info.id === user.info.id)).toBe(true)
          const summaries = history.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          expect(summaries).toHaveLength(1)
          const summary = summaries.at(0)!
          if (summary.info.role !== "assistant") throw new Error("expected assistant summary")
          expect(summary.parts.some((part) => part.type === "text" && part.text.includes("unfinished sentence"))).toBe(
            false,
          )
          expect(result).toBe("stop")
          expect(summary.info.finish).toBe("error")
          expect(errors).toEqual([{ sessionID: chat.id, error: summary.info.error }])
          expect(
            MessageV2.filterCompacted(yield* MessageV2.stream(chat.id)).some((msg) => msg.info.id === user.info.id),
          ).toBe(true)
          expect(summary.info.error?.name).toBe("APIError")
          if (summary.info.error?.name !== "APIError") return
          expect(summary.info.error.data.message).toBe("provider failure after length")
          expect(summary.info.error.data.statusCode).toBe(400)
          expect(summary.info.error.data.isRetryable).toBe(false)
          expect(
            summary.parts.some((part) => part.type === "text" && part.text === KiloCompactionChunks.TRUNCATED_SUMMARY),
          ).toBe(false)
        }),
        { config: (url) => ({ ...providerCfg(url), compaction: { tail_turns: 0 } }) },
      ),
    120_000,
  )
  testEffect(makeHttp(undefined, true)).live(
    "preserves the provider error after a chunk worker length finish",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ llm }) {
          const sessions = yield* Session.Service
          const prompt = yield* SessionPrompt.Service
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
          yield* llm.push(reply().text("unfinished sentence").finish("length"))
          yield* llm.error(400, { error: { message: "provider failure after length" } })
          const user = yield* prompt.prompt({
            sessionID: chat.id,
            agent: "code",
            model: ref,
            noReply: true,
            parts: [{ type: "text", text: "x".repeat(400_000) }],
          })
          yield* compaction.create({ sessionID: chat.id, agent: "code", model: ref, auto: false })
          const messages = yield* sessions.messages({ sessionID: chat.id })
          const result = yield* compaction.process({
            sessionID: chat.id,
            parentID: messages.at(-1)!.info.id,
            messages,
            auto: false,
          })
          expect(yield* llm.calls).toBe(2)
          expect(JSON.stringify((yield* llm.inputs).at(0))).toContain("Summarize conversation chunk")
          const history = yield* sessions.messages({ sessionID: chat.id })
          expect(history.some((msg) => msg.info.id === user.info.id)).toBe(true)
          const summaries = history.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
          expect(summaries).toHaveLength(1)
          const summary = summaries.at(0)!
          if (summary.info.role !== "assistant") throw new Error("expected assistant summary")
          expect(result).toBe("stop")
          expect(summary.info).toMatchObject({
            finish: "error",
            error: {
              name: "APIError",
              data: { message: "provider failure after length", statusCode: 400, isRetryable: false },
            },
          })
          expect(errors).toEqual([{ sessionID: chat.id, error: summary.info.error }])
          expect(summary.parts.filter((part) => part.type === "text")).toEqual([])
          expect(JSON.stringify(history)).not.toContain("unfinished sentence")
          expect(JSON.stringify(history)).not.toContain(KiloCompactionChunks.TRUNCATED_SUMMARY)
          expect(JSON.stringify(errors)).not.toContain(KiloCompactionChunks.TRUNCATED_SUMMARY)
        }),
        { config: (url) => ({ ...providerCfg(url), compaction: { tail_turns: 0 } }) },
      ),
    120_000,
  )

  for (const scenario of [
    { name: "chunk", text: "x".repeat(400_000), replies: ["length"], calls: 1 },
    { name: "reduce", text: "x".repeat(160_000), turns: 2, replies: ["stop", "stop", "length"], calls: 3 },
    { name: "single pass fallback", text: "please compact", replies: ["length", "stop", "stop"], calls: 3 },
    { name: "single pass and fallback failure", text: "please compact", replies: ["length", "length"], calls: 2 },
  ]) {
    it.live(
      `rejects truncated ${scenario.name} summaries without losing history`,
      () =>
        provideTmpdirServer(
          Effect.fnUntraced(function* ({ llm }) {
            const sessions = yield* Session.Service
            const prompt = yield* SessionPrompt.Service
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
            for (const reason of scenario.replies)
              yield* llm.push(
                reply()
                  .text(reason === "length" ? "unfinished sentence" : "complete summary")
                  .finish(reason),
              )
            const user = yield* prompt.prompt({
              sessionID: chat.id,
              agent: "code",
              model: ref,
              noReply: true,
              parts: [{ type: "text", text: scenario.text }],
            })
            if (scenario.turns === 2)
              yield* prompt.prompt({
                sessionID: chat.id,
                agent: "code",
                model: ref,
                noReply: true,
                parts: [{ type: "text", text: scenario.text }],
              })
            yield* compaction.create({ sessionID: chat.id, agent: "code", model: ref, auto: false })
            const messages = yield* sessions.messages({ sessionID: chat.id })
            const result = yield* compaction.process({
              sessionID: chat.id,
              parentID: messages.at(-1)!.info.id,
              messages,
              auto: false,
            })
            expect(yield* llm.calls).toBe(scenario.calls)
            const history = yield* sessions.messages({ sessionID: chat.id })
            const summaries = history.filter((msg) => msg.info.role === "assistant" && msg.info.summary)
            expect(summaries).toHaveLength(1)
            expect(
              history
                .flatMap((msg) => msg.parts)
                .some((part) => part.type === "text" && part.text === "unfinished sentence"),
            ).toBe(false)
            const summary = summaries.at(0)!
            expect(summary.info.role).toBe("assistant")
            if (summary.info.role !== "assistant") return
            if (scenario.name === "single pass fallback") {
              expect(result).toBe("continue")
              expect(summary.info.finish).toBe("stop")
              expect(summary.info.error).toBeUndefined()
              expect(errors).toEqual([])
              expect(summary.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
                "complete summary",
              ])
              return
            }
            expect(result).toBe("stop")
            expect(summary.info.finish).toBe("error")
            expect(summary.info.error?.name).toBe("APIError")
            if (summary.info.error?.name !== "APIError") return
            expect(summary.info.error.data.isRetryable).toBe(true)
            expect(summary.info.error.data.message).toContain("cut off at the output limit")
            expect(errors).toEqual([{ sessionID: chat.id, error: summary.info.error }])
            expect(history.some((msg) => msg.info.id === user.info.id)).toBe(true)
            expect(
              MessageV2.filterCompacted(yield* MessageV2.stream(chat.id)).some((msg) => msg.info.id === user.info.id),
            ).toBe(true)
            expect(
              history.flatMap((msg) => msg.parts).some((part) => part.type === "compaction" && part.tail_start_id),
            ).toBe(false)
            expect(summary.parts.filter((part) => part.type === "text").map((part) => part.text)).toEqual([
              summary.info.error.data.message,
            ])
          }),
          { config: (url) => ({ ...providerCfg(url), compaction: { tail_turns: 0 } }) },
        ),
      30_000,
    )
  }

  for (const scenario of [
    { name: "Claude", npm: "@ai-sdk/anthropic", id: "claude-test", max: undefined, expected: 128_000 },
    { name: "non-Claude", npm: "@ai-sdk/openai-compatible", id: "test-model", max: undefined, expected: 32_000 },
    { name: "Claude runtime limit", npm: "@ai-sdk/anthropic", id: "claude-test", max: 4_096, expected: 4_096 },
    {
      name: "non-Claude runtime limit",
      npm: "@ai-sdk/openai-compatible",
      id: "test-model",
      max: 4_096,
      expected: 4_096,
    },
    {
      name: "Claude remaining window",
      npm: "@ai-sdk/anthropic",
      id: "claude-test",
      max: undefined,
      expected: 128_000,
      context: 150_000,
    },
  ]) {
    testEffect(makeHttp(scenario.max)).live(
      `uses the normal output budget for ${scenario.name} chunk and reduce requests`,
      () =>
        Effect.gen(function* () {
          const hits: Array<Record<string, unknown>> = []
          const server = Bun.serve({
            hostname: "127.0.0.1",
            port: 0,
            async fetch(req) {
              const body = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(await req.json())
              hits.push(body)
              if (scenario.npm === "@ai-sdk/anthropic") {
                const events = [
                  {
                    type: "message_start",
                    message: {
                      id: "msg_test",
                      type: "message",
                      role: "assistant",
                      model: scenario.id,
                      content: [],
                      stop_reason: null,
                      stop_sequence: null,
                      usage: { input_tokens: 1, output_tokens: 0 },
                    },
                  },
                  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
                  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "complete summary" } },
                  { type: "content_block_stop", index: 0 },
                  {
                    type: "message_delta",
                    delta: { stop_reason: "end_turn", stop_sequence: null },
                    usage: { output_tokens: 10 },
                  },
                  { type: "message_stop" },
                ]
                return new Response(
                  events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(""),
                  { headers: { "content-type": "text/event-stream" } },
                )
              }
              const events = [
                { choices: [{ delta: { role: "assistant", content: "complete summary" } }] },
                {
                  choices: [{ delta: {}, finish_reason: "stop" }],
                  usage: { prompt_tokens: 1, completion_tokens: 10, total_tokens: 11 },
                },
              ]
              return new Response(
                events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n",
                { headers: { "content-type": "text/event-stream" } },
              )
            },
          })
          yield* Effect.addFinalizer(() => Effect.promise(() => server.stop(true)))
          const model = { providerID: ref.providerID, modelID: ModelV2.ID.make(scenario.id), variant: "xhigh" }
          yield* provideTmpdirProject(
            Effect.fnUntraced(function* () {
              const sessions = yield* Session.Service
              const prompt = yield* SessionPrompt.Service
              const compaction = yield* SessionCompaction.Service
              const chat = yield* sessions.create({})
              for (const text of ["a", "b"])
                yield* prompt.prompt({
                  sessionID: chat.id,
                  agent: "code",
                  model,
                  noReply: true,
                  parts: [{ type: "text", text: text.repeat(scenario.context ? 240_000 : 1_600_000) }],
                })
              yield* compaction.create({ sessionID: chat.id, agent: "code", model, auto: false })
              const messages = yield* sessions.messages({ sessionID: chat.id })
              expect(
                yield* compaction.process({
                  sessionID: chat.id,
                  parentID: messages.at(-1)!.info.id,
                  messages,
                  auto: false,
                }),
              ).toBe("continue")
              expect(hits).toHaveLength(3)
              expect(JSON.stringify(hits.at(0))).toContain("Summarize conversation chunk")
              expect(JSON.stringify(hits.at(-1))).toContain("partial-summary")
              if (scenario.context) {
                expect(hits.at(0)?.max_tokens).toBeGreaterThan(60_000)
                expect(hits.at(0)?.max_tokens).toBeLessThan(80_000)
                expect(hits.at(-1)?.max_tokens).toBe(128_000)
                return
              }
              expect(hits.map((hit) => hit.max_tokens)).toEqual([
                scenario.expected,
                scenario.expected,
                scenario.expected,
              ])
              expect(hits.every((hit) => !("maxOutputTokens" in hit))).toBe(true)
              if (scenario.npm === "@ai-sdk/anthropic")
                for (const hit of hits) expect(hit.thinking).toMatchObject({ type: "adaptive" })
            }),
            {
              config: {
                compaction: { tail_turns: 0 },
                agent: { compaction: { options: { maxOutputTokens: 123 } } },
                provider: {
                  test: {
                    npm: scenario.npm,
                    options: { apiKey: "test-key", baseURL: `http://127.0.0.1:${server.port}/v1` },
                    models: {
                      [scenario.id]: {
                        id: scenario.id,
                        name: "Test",
                        reasoning: true,
                        limit: { context: scenario.context ?? 1_000_000, output: 128_000 },
                        options: { thinking: { type: "adaptive" }, effort: "high" },
                        variants: { xhigh: { thinking: { type: "adaptive" }, effort: "high" } },
                      },
                    },
                  },
                },
              },
            },
          ).pipe(Effect.provide(RuntimeFlags.layer({ outputTokenMax: scenario.max })))
        }),
      30_000,
    )
  }

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
