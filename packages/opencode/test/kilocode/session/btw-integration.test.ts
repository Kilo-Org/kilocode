import path from "node:path"
import { afterAll, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent as AgentSvc } from "../../../src/agent/agent"
import { BackgroundJob } from "../../../src/background/job"
import { Command } from "../../../src/command"
import { Config } from "../../../src/config/config"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Env } from "../../../src/env"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../../src/format"
import { Git } from "../../../src/git"
import { Image } from "../../../src/image/image"
import { LSP } from "../../../src/lsp/lsp"
import { MCP } from "../../../src/mcp"
import { Permission } from "../../../src/permission"
import { Plugin } from "../../../src/plugin"
import { Provider as ProviderSvc } from "../../../src/provider/provider"
import { Question } from "../../../src/question"
import { SessionCompaction } from "../../../src/session/compaction"
import { Instruction } from "../../../src/session/instruction"
import { LLM } from "../../../src/session/llm"
import { SessionProcessor } from "../../../src/session/processor"
import { SessionPrompt } from "../../../src/session/prompt"
import { SessionRevert } from "../../../src/session/revert"
import { SessionRunState } from "../../../src/session/run-state"
import { Session } from "../../../src/session/session"
import { MessageV2 } from "../../../src/session/message-v2"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SystemPrompt } from "../../../src/session/system"
import { SessionSummary } from "../../../src/session/summary"
import { Todo } from "../../../src/session/todo"
import { Skill } from "../../../src/skill"
import { Snapshot } from "../../../src/snapshot"
import { ToolRegistry } from "../../../src/tool/registry"
import { Truncate } from "../../../src/tool/truncate"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { KiloBtw } from "../../../src/kilocode/session/btw"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { TestInstance, disposeAllInstances } from "../../fixture/fixture"
import { testEffect, awaitWithTimeout, pollWithTimeout } from "../../lib/effect"
import { TestLLMServer } from "../../lib/llm-server"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

// ── Test layer (mirrors test/kilocode/session-resume-integration.test.ts) ──

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const buildAgent: AgentSvc.Info = {
  name: "build",
  mode: "primary",
  native: true,
  permission: Permission.fromConfig({ "*": "allow" }),
  model: ref,
  options: {},
}

const askAgent: AgentSvc.Info = {
  name: "ask",
  mode: "primary",
  native: true,
  permission: Permission.fromConfig({ "*": "allow" }),
  model: ref,
  options: {},
}

const fastAgents = Layer.mock(AgentSvc.Service)({
  get: () => Effect.succeed(buildAgent),
  list: () => Effect.succeed([buildAgent, askAgent]),
  defaultInfo: () => Effect.succeed(buildAgent),
  defaultAgent: () => Effect.succeed(buildAgent.name),
})

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
    instructions: () => Effect.succeed([]),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth"),
    authenticate: () => Effect.die("unexpected MCP auth"),
    finishAuth: () => Effect.die("unexpected MCP auth"),
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

const memoryNode = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const serverNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const root = LayerNode.group([
  SessionPrompt.node,
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

const replacements = [
  [SessionSummary.node, summary],
  [AgentSvc.node, fastAgents],
  [LSP.node, lsp],
  [MCP.node, mcp],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  [KiloSessions.node, KiloSessions.testLayer],
] as const

const it = testEffect(LayerNode.compile(root, replacements))

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fsys = yield* FSUtil.Service
  yield* fsys.writeWithDirs(file, text)
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<Config.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeText(path.join(dir, "opencode.json"), JSON.stringify({ $schema: "https://app.kilo.ai/config.json", ...config(llm.url) }))
  return { dir, llm }
})

const boot = Effect.fn("test.boot")(function* () {
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const chat = yield* sessions.create({
    agent: "build",
    model: { id: ref.modelID, providerID: ref.providerID },
  })
  return { prompt, sessions, chat }
})

// ── Tests ──────────────────────────────────────────────────────────────

it.instance(
  "btw answers in the transcript, deletes the fork, and keeps parent parts out of model history",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const llm = yield* TestLLMServer
      yield* llm.text("42 is the answer")

      const result = yield* prompt.command({
        sessionID: chat.id,
        command: "btw",
        arguments: "what is 2+2?",
        agent: "build",
      })

      expect(result.info.role).toBe("assistant")
      expect(result.parts[0].type).toBe("text")
      expect((result.parts[0] as MessageV2.TextPart).text).toContain("42 is the answer")
      expect((result.parts[0] as MessageV2.TextPart).ignored).toBe(true)

      // The side Q&A is stored for /btw (no args) but marked ignored on the parent.
      const entries = yield* KiloBtw.list(chat.id)
      expect(entries.length).toBe(1)
      expect(entries[0].question).toBe("what is 2+2?")
      expect(entries[0].answer).toBe("42 is the answer")

      // Every text part on the parent is ignored, so nothing leaks into later requests.
      const msgs = yield* sessions.messages({ sessionID: chat.id })
      expect(msgs.length).toBe(2)
      for (const msg of msgs) {
        for (const part of msg.parts) {
          if (part.type === "text") expect(part.ignored).toBe(true)
        }
      }

      // The fork is gone. The fork is created with parentID = chat.id, so a
      // live fork would appear in children() — an empty list proves removal.
      const children = yield* sessions.children(chat.id)
      expect(children.length).toBe(0)

      // Exactly one LLM request happened (inside the fork).
      expect(yield* llm.calls).toBe(1)
    }),
  60_000,
)

it.instance(
  "btw fork runs as a child session of the parent",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const llm = yield* TestLLMServer
      // Stream some text, then stall the reply until the test releases it.
      let release!: (value?: unknown) => void
      const gate = new Promise((resolve) => (release = resolve))
      yield* llm.hold("partial answer", gate)

      const fiber = yield* prompt
        .command({
          sessionID: chat.id,
          command: "btw",
          arguments: "long running question?",
          agent: "build",
        })
        .pipe(Effect.forkChild)

      // While the side question runs, the fork is registered as a child of
      // the parent session — this is what makes parent-stop cancellation
      // ride the existing cancel tree (KiloSessionPrompt.cancelTree walks
      // sessions.children, which queries parent_id).
      const children = yield* pollWithTimeout(
        Effect.gen(function* () {
          const kids = yield* sessions.children(chat.id)
          return kids.length === 1 ? kids : undefined
        }),
        "fork did not appear as a child session",
        30_000,
      )
      expect(children[0]!.parentID).toBe(chat.id)

      // Release the held reply, then the command completes and the fork is gone.
      release!()
      const exit = yield* awaitWithTimeout(Effect.exit(Fiber.await(fiber)), "btw command did not finish", 30_000)
      expect(Exit.isSuccess(exit)).toBe(true)
      const kids = yield* sessions.children(chat.id)
      expect(kids.length).toBe(0)
    }),
  60_000,
)

it.instance(
  "btw surfaces provider failures instead of fabricating an answer",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const llm = yield* TestLLMServer
      yield* llm.fail("provider exploded")

      const result = yield* prompt.command({
        sessionID: chat.id,
        command: "btw",
        arguments: "hello?",
        agent: "build",
      })

      expect((result.parts[0] as MessageV2.TextPart).text).toContain("BTW failed")
      expect(result.info.role).toBe("assistant")
      const info = result.info as MessageV2.Assistant
      expect(info.finish).toBe("error")
      expect(info.error).toBeTruthy()

      const entries = yield* KiloBtw.list(chat.id)
      expect(entries.length).toBe(0)

      const children = yield* sessions.children(chat.id)
      expect(children.length).toBe(0)
    }),
  60_000,
)

it.instance(
  "btw with no arguments shows usage and creates no fork",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()

      const result = yield* prompt.command({
        sessionID: chat.id,
        command: "btw",
        arguments: "",
        agent: "build",
      })

      expect((result.parts[0] as MessageV2.TextPart).text).toContain("Usage: /btw")
      const children = yield* sessions.children(chat.id)
      expect(children.length).toBe(0)
      expect(yield* (yield* TestLLMServer).calls).toBe(0)
    }),
  60_000,
)

afterAll(async () => {
  await disposeAllInstances()
})
