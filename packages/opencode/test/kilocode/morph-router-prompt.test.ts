// kilocode_change - new file
//
// Integration tests for Morph auto model routing through the real session
// prompt loop. A fake "anthropic" provider (backed by the in-process
// TestLLMServer) is configured alongside a connected "morph" provider, and
// global fetch is mocked ONLY for the Morph router endpoint so the
// "morph/auto" pseudo-model resolves to the fake concrete provider.

import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { Env } from "../../src/env"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { KiloMorphRouter } from "../../src/kilocode/provider/morph-router"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { ModelID, ProviderID } from "../../src/provider/schema"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { SyncEvent } from "../../src/sync"
import { Ripgrep } from "../../src/file/ripgrep"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { provideTmpdirServer } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

void Log.init({ print: false })

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
    startAuth: () => Effect.die("unexpected MCP auth in morph router prompt tests"),
    authenticate: () => Effect.die("unexpected MCP auth in morph router prompt tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in morph router prompt tests"),
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
    Plugin.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    AppFileSystem.defaultLayer,
    Reference.defaultLayer,
    SyncEvent.defaultLayer,
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
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
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
    Layer.provide(Layer.mergeAll(summary, deps, Config.defaultLayer, RuntimeFlags.layer(), BackgroundJob.defaultLayer)),
  )
}

const it = testEffect(makeHttp())

// The "morph/auto" pseudo-model selection.
const auto = {
  providerID: ProviderID.make(KiloMorphRouter.PROVIDER_ID),
  modelID: ModelID.make(KiloMorphRouter.MODEL_ID),
}

// Fake "anthropic" provider served by the in-process TestLLMServer (the
// router can route to it), plus a connected "morph" provider whose catalog
// entry carries the injected "auto" pseudo-model. enabled_providers keeps the
// test deterministic even when the machine has other provider API keys in env.
function morphCfg(url: string) {
  return {
    enabled_providers: ["anthropic", "morph"],
    provider: {
      anthropic: {
        name: "Fake Anthropic",
        npm: "@ai-sdk/openai-compatible",
        models: {
          "claude-sonnet-4-6": {
            id: "claude-sonnet-4-6",
            name: "Fake Sonnet",
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
          apiKey: "test-anthropic-key",
          baseURL: url,
        },
      },
      morph: {
        name: "Morph",
        options: {
          apiKey: "sk-morph-test",
        },
      },
    },
  }
}

// Mock global fetch ONLY for the Morph router endpoint. Everything else
// (the TestLLMServer, models.dev catalog refresh, ...) passes through to the
// real fetch so the rest of the harness keeps working.
const realFetch = globalThis.fetch

function mockRouterFetch(handler: () => Response | Promise<Response>) {
  const calls: { url: string; body: any }[] = []
  const mocked = async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : String(input?.url ?? input)
    if (url.includes("/router/multimodel")) {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      return handler()
    }
    return realFetch(input, init)
  }
  // Keep Bun's extra fetch properties (e.g. preconnect) intact for callers.
  Object.assign(mocked, { preconnect: (realFetch as any).preconnect?.bind(realFetch) })
  globalThis.fetch = mocked as typeof fetch
  return calls
}

afterEach(() => {
  globalThis.fetch = realFetch
  KiloMorphRouter.resetCache()
})

it.live(
  "morph/auto turn is routed once and answered by the concrete provider",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        KiloMorphRouter.resetCache()
        const calls = mockRouterFetch(() =>
          Response.json({ model: "claude-sonnet-4-6", provider: "anthropic", difficulty: "easy" }),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const provider = yield* ProviderSvc.Service

        // The morph provider is connected and exposes the injected "auto"
        // pseudo-model; the fake anthropic provider exposes the routed model.
        const providers = yield* provider.list()
        expect(providers[auto.providerID]).toBeDefined()
        expect(providers[auto.providerID]?.models[KiloMorphRouter.MODEL_ID]?.name).toBe(KiloMorphRouter.MODEL_NAME)
        expect(providers[ProviderID.make("anthropic")]?.models["claude-sonnet-4-6"]).toBeDefined()

        const chat = yield* sessions.create({
          title: "Morph router",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          model: auto,
          noReply: true,
          parts: [{ type: "text", text: "add error handling to the parser" }],
        })

        // Two LLM steps (a tool call, then text) prove the turn runs multiple
        // loop iterations while the router is consulted only once.
        yield* llm.tool("first", { value: "first" })
        yield* llm.text("routed answer")

        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(result.info.role).toBe("assistant")
        if (result.info.role !== "assistant") return

        // (b) the assistant message ran on the routed concrete model
        expect(result.info.providerID).toBe(ProviderID.make("anthropic"))
        expect(result.info.modelID).toBe(ModelID.make("claude-sonnet-4-6"))
        // (a) the turn completed with the fake provider's reply
        expect(result.parts.some((part) => part.type === "text" && part.text === "routed answer")).toBe(true)
        expect(yield* llm.pending).toBe(0)

        // (c) exactly one router request despite multiple loop steps
        expect(calls.length).toBe(1)
        expect(calls[0].url).toBe("https://api.morphllm.com/v1/router/multimodel")
        expect(calls[0].body).toMatchObject({
          input: "add error handling to the parser",
          allowed_providers: ["anthropic"],
          policy: "balanced",
          default_model: "claude-sonnet-4-6",
        })

        // (d) the persisted user message keeps the morph/auto selection sticky
        const msgs = yield* sessions.messages({ sessionID: chat.id })
        const userMsg = msgs.find(
          (msg) =>
            msg.info.role === "user" &&
            msg.parts.some((part) => part.type === "text" && part.text === "add error handling to the parser"),
        )
        expect(userMsg).toBeDefined()
        if (userMsg?.info.role !== "user") return
        expect(userMsg.info.model.providerID).toBe(auto.providerID)
        expect(userMsg.info.model.modelID).toBe(auto.modelID)
      }),
      { git: true, config: morphCfg },
    ),
  30_000,
)

it.live(
  "morph/auto turn still completes on the fallback model when the router errors",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        KiloMorphRouter.resetCache()
        const calls = mockRouterFetch(() => new Response("oops", { status: 500 }))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service

        const chat = yield* sessions.create({
          title: "Morph router fallback",
          permission: [{ permission: "*", pattern: "*", action: "allow" }],
        })
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          model: auto,
          noReply: true,
          parts: [{ type: "text", text: "hello there" }],
        })
        yield* llm.text("fallback answer")

        const result = yield* prompt.loop({ sessionID: chat.id })
        expect(result.info.role).toBe("assistant")
        if (result.info.role !== "assistant") return

        // The FALLBACKS entry ["anthropic", "claude-sonnet-4-6"] matches the
        // fake provider, so the turn degrades to it instead of failing.
        expect(result.info.providerID).toBe(ProviderID.make("anthropic"))
        expect(result.info.modelID).toBe(ModelID.make("claude-sonnet-4-6"))
        expect(result.parts.some((part) => part.type === "text" && part.text === "fallback answer")).toBe(true)
        expect(calls.length).toBe(1)
      }),
      { git: true, config: morphCfg },
    ),
  30_000,
)
