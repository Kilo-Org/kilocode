import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { SessionExecution } from "@opencode-ai/core/session/execution"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import type { Tool as MCPToolDef } from "@modelcontextprotocol/sdk/types.js"
import { describe, expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import fs from "node:fs/promises"
import path from "node:path"
import { Agent as AgentSvc } from "@/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "@/command"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Env } from "@/env"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Format } from "@/format"
import { Git } from "@/git"
import { Image } from "@/image/image"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import type { SandboxConfig } from "@/kilocode/sandbox/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Question } from "@/question"
import { Session } from "@/session/session"
import { SessionCompaction } from "@/session/compaction"
import { Instruction } from "@/session/instruction"
import { LLM } from "@/session/llm"
import { MessageV2 } from "@/session/message-v2"
import { SessionProcessor } from "@/session/processor"
import { SessionPrompt } from "@/session/prompt"
import { SessionRevert } from "@/session/revert"
import { SessionRunState } from "@/session/run-state"
import { MessageID, PartID, type SessionID } from "@/session/schema"
import { SessionStatus } from "@/session/status"
import { SessionSummary } from "@/session/summary"
import { SystemPrompt } from "@/session/system"
import { Todo } from "@/session/todo"
import { Skill } from "@/skill"
import { Snapshot } from "@/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../../fixture/fixture"
import { awaitWithTimeout, testEffect } from "../../lib/effect"
import { TestLLMServer } from "../../lib/llm-server"

const build: AgentSvc.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow" }),
  options: {},
}

const modelRef = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const client = new Client({ name: "mcp-instructions-test", version: "1.0.0" })

const lookupDef: MCPToolDef = {
  name: "lookup",
  description: "Lookup domain entry",
  inputSchema: { type: "object", properties: {} },
}

const mcpInstructions: MCP.ServerInstructions[] = [
  {
    name: "guide-server",
    instructions: "Use lookup before mutate.",
    tools: [],
  },
  {
    name: "tool-server",
    instructions: "Prefer search before update.",
    tools: ["tool-server_lookup"],
  },
]

const mcpMock = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    instructions: () => Effect.succeed(mcpInstructions),
    tools: () =>
      Effect.succeed({
        "tool-server_lookup": {
          def: lookupDef,
          client,
          clientName: "tool-server",
        },
      }),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    resourceTemplates: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    remove: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in mcp-instructions test"),
    authenticate: () => Effect.die("unexpected MCP auth in mcp-instructions test"),
    finishAuth: () => Effect.die("unexpected MCP auth in mcp-instructions test"),
    removeAuth: () => Effect.void,
    cancelAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const systemIt = testEffect(
  AppNodeBuilder.build(SystemPrompt.node, [
    [MCP.node, mcpMock],
    [
      Skill.node,
      Layer.succeed(
        Skill.Service,
        Skill.Service.of({
          get: () => Effect.succeed(undefined),
          require: (name) => Effect.fail(new Skill.NotFoundError({ name, available: [] })),
          all: () => Effect.succeed([]),
          dirs: () => Effect.succeed([]),
          available: () => Effect.succeed([]),
        }),
      ),
    ],
  ]),
)

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
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
const testLLMServerNode = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })

const promptRoot = LayerNode.group([
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
])

const loopIt = testEffect(
  LayerNode.compile(LayerNode.group([promptRoot, testLLMServerNode]), [
    [SessionSummary.node, summary],
    [LSP.node, lsp],
    [MCP.node, mcpMock],
    [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
    [KiloSessions.node, KiloSessions.testLayer],
    [SessionExecution.node, SessionExecution.noopLayer],
  ]),
)

function providerCfg(url: string): Partial<ConfigV1.Info> {
  return {
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
            limit: { context: 100_000, output: 10_000 },
            cost: { input: 0, output: 0 },
            options: {},
          },
        },
        options: {
          apiKey: "test-key",
          baseURL: url,
        },
      },
    },
  }
}

const seedUser = Effect.fn("test.seedUser")(function* (sessionID: SessionID, text: string) {
  const sessions = yield* Session.Service
  const msg = yield* sessions.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: modelRef,
    time: { created: Date.now() },
  })
  yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

function withGlobalSandbox(sandbox: SandboxConfig.Info) {
  return Effect.gen(function* () {
    const cfg = yield* Config.Service
    const file = path.join(Global.Path.config, "kilo.json")
    const prior = yield* Effect.promise(() =>
      fs.readFile(file, "utf8").catch((err: NodeJS.ErrnoException) => {
        if (err.code === "ENOENT") return undefined
        throw err
      }),
    )

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          prior === undefined ? fs.rm(file, { force: true }) : fs.writeFile(file, prior, "utf8"),
        )
        yield* cfg.invalidate()
      }).pipe(Effect.ignore),
    )

    yield* Effect.promise(async () => {
      await fs.mkdir(Global.Path.config, { recursive: true })
      await fs.writeFile(file, JSON.stringify({ sandbox }, null, 2), "utf8")
    })
    yield* cfg.invalidate()
  })
}

const runPromptWithSandbox = (sandbox: SandboxConfig.Info) =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const llm = yield* TestLLMServer
    const fsys = yield* FSUtil.Service
    const prompt = yield* SessionPrompt.Service
    const sessions = yield* Session.Service

    yield* withGlobalSandbox(sandbox)
    yield* fsys.writeWithDirs(
      path.join(instance.directory, "opencode.json"),
      JSON.stringify({
        $schema: "https://app.kilo.ai/config.json",
        ...providerCfg(llm.url),
      }),
    )

    const chat = yield* sessions.create({
      title: "sandbox-mcp-instructions",
      permission: [{ permission: "*", pattern: "*", action: "allow" }],
    })
    yield* llm.hang
    yield* seedUser(chat.id, "hello")

    const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)
    yield* awaitWithTimeout(llm.wait(1), "timed out waiting for model request", "10 seconds")

    const hits = yield* llm.hits
    yield* Fiber.interrupt(fiber)
    return JSON.stringify(hits[0]?.body ?? {})
  })

describe("kilocode/sandbox/mcp-instructions (#16565)", () => {
  systemIt.effect("SystemPrompt.mcp skips all MCP instructions when networkRestricted is true", () =>
    Effect.gen(function* () {
      const prompt = yield* SystemPrompt.Service

      const normal = yield* prompt.mcp(build)
      const explicitAllow = yield* prompt.mcp(build, undefined, { networkRestricted: false })
      const restricted = yield* prompt.mcp(build, undefined, { networkRestricted: true })

      expect(normal).toContain("<mcp_instructions>")
      expect(normal).toContain("Use lookup before mutate.")
      expect(normal).toContain("Prefer search before update.")
      expect(explicitAllow).toBe(normal)
      expect(restricted).toBeUndefined()
    }),
  )

  loopIt.instance(
    "omits MCP instructions from system prompt when sandbox.network is deny",
    () =>
      Effect.gen(function* () {
        const body = yield* runPromptWithSandbox({ enabled: true, network: "deny" })

        expect(body).not.toContain("<mcp_instructions>")
        expect(body).not.toContain("Use lookup before mutate.")
        expect(body).not.toContain("Prefer search before update.")
        expect(body).not.toContain("tool-server_lookup")
      }),
    15_000,
  )

  loopIt.instance(
    "omits MCP instructions from system prompt when sandbox uses proxy mode via allowed_hosts",
    () =>
      Effect.gen(function* () {
        const body = yield* runPromptWithSandbox({
          enabled: true,
          allowed_hosts: ["api.github.com"],
        })

        expect(body).not.toContain("<mcp_instructions>")
        expect(body).not.toContain("Use lookup before mutate.")
        expect(body).not.toContain("Prefer search before update.")
        expect(body).not.toContain("tool-server_lookup")
      }),
    15_000,
  )

  loopIt.instance(
    "keeps MCP instructions and MCP tools when sandbox.network is allow",
    () =>
      Effect.gen(function* () {
        const body = yield* runPromptWithSandbox({ enabled: true, network: "allow" })

        expect(body).toContain("<mcp_instructions>")
        expect(body).toContain("Use lookup before mutate.")
        expect(body).toContain("Prefer search before update.")
        expect(body).toContain("tool-server_lookup")
      }),
    15_000,
  )

  loopIt.instance(
    "keeps MCP instructions and MCP tools when sandbox is disabled",
    () =>
      Effect.gen(function* () {
        const body = yield* runPromptWithSandbox({ enabled: false, network: "deny" })

        expect(body).toContain("<mcp_instructions>")
        expect(body).toContain("Use lookup before mutate.")
        expect(body).toContain("Prefer search before update.")
        expect(body).toContain("tool-server_lookup")
      }),
    15_000,
  )
})
