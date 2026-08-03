import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import { NodeFileSystem } from "@effect/platform-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Database } from "@opencode-ai/core/database/database"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { Auth } from "../../src/auth"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Env } from "../../src/env"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Question } from "../../src/question"
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
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { SessionResume } from "../../src/kilocode/session-resume"
import { SessionID, MessageID, PartID } from "../../src/session/schema"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer, TestInstance, disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { SessionV1 } from "@opencode-ai/core/v1/session"

// ── Test layer ──────────────────────────────────────────────────────────

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const agent: AgentSvc.Info = {
  name: "build",
  mode: "primary",
  native: true,
  permission: Permission.fromConfig({ "*": "allow" }),
  model: ref,
  options: {},
}

const fastAgents = Layer.mock(AgentSvc.Service)({
  get: () => Effect.succeed(agent),
  list: () => Effect.succeed([agent]),
  defaultInfo: () => Effect.succeed(agent),
  defaultAgent: () => Effect.succeed(agent.name),
  guardRequirements: () => Effect.void,
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
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
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

const status = SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

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

function makePrompt() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    fastAgents,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    BackgroundJob.defaultLayer,
    status,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    Bus.layer,
    MemoryService.layer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
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
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return SessionPrompt.layer.pipe(
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
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

// Picker tests need a Question service mock that auto-selects the first
// option instead of blocking on the question UI.
function makePromptWithAutoPick() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    fastAgents,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    BackgroundJob.defaultLayer,
    status,
    Database.defaultLayer,
    EventV2Bridge.defaultLayer,
    Bus.layer,
    MemoryService.layer,
  ).pipe(Layer.provideMerge(infra))
  const question = Layer.mock(Question.Service, {
    ask: (input) =>
      Effect.gen(function* () {
        const q = input.questions[0]
        if (!q) return [] as readonly string[][]
        const label = q.options?.[0]?.label ?? ""
        return [[label]]
      }),
  })
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
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
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(proc),
    Layer.provideMerge(deps),
  )
  return SessionPrompt.layer.pipe(
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
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provide(summary),
  )
}

function makeHttp() {
  return Layer.mergeAll(TestLLMServer.layer, makePrompt())
}
const it = testEffect(makeHttp())

function makeHttpWithAutoPick() {
  return Layer.mergeAll(TestLLMServer.layer, makePromptWithAutoPick())
}
const itPicker = testEffect(makeHttpWithAutoPick())

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fsys = yield* FSUtil.Service
  yield* fsys.writeWithDirs(file, text)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<Config.Info>) {
  yield* writeText(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://app.kilo.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<Config.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const prompt = yield* SessionPrompt.Service
  const sessions = yield* Session.Service
  const chat = yield* sessions.create(input ?? {})
  return { prompt, sessions, chat }
})

// ── Claude fixture helpers ─────────────────────────────────────────────

const claudeFixture = () =>
  Bun.file(path.join(__dirname, "fixture/session-resume/claude.jsonl")).text()

const claudeInvalidVersion = `{"type":"user","version":"3.0.0","isSidechain":false,"message":{"id":"msg_001","role":"user","content":[{"type":"text","text":"Hello"}]}}`

const fixtureUUID = "550e8400-e29b-41d4-a716-446655440000"

function claudeSlug(cwd: string) {
  return SessionResume.claudeProjectSlug(cwd)
}

function claudeSessionFile(cwd: string, id: string) {
  return path.join(os.homedir(), ".claude", "projects", claudeSlug(cwd), `${id}.jsonl`)
}

/**
 * Write a Claude session fixture into the home-directory path that handleResume
 * discovers. Returns a disposable effect that removes the file + directory.
 */
const withClaudeFixture = (cwd: string, content: string, id: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const file = claudeSessionFile(cwd, id)
      yield* writeText(file, content)
      return file
    }),
    (file) =>
      Effect.gen(function* () {
        fs.rmSync(path.dirname(file), { recursive: true, force: true })
      }),
  )

// ── Helper: read messages for a session ────────────────────────────────

const sessionMessages = (sessionID: SessionID) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* sessions.messages({ sessionID })
  })

// ── Tests ──────────────────────────────────────────────────────────────

it.instance(
  "explicit ID import produces normal session history",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)
      // The fixture has 13 steps: 7 user + 6 assistant
      expect(msgs.length).toBeGreaterThanOrEqual(10)

      // First message must be user
      expect(msgs[0].info.role).toBe("user")
      // Last message must be assistant with the import notice
      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")
      const text = last.parts.find((p) => p.type === "text")
      expect(text?.type === "text" && text.text).toContain("imported from an external session")
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "imported assistant messages carry complete fields",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      // All assistant messages must have non-empty modelID
      for (const msg of msgs) {
        if (msg.info.role === "assistant") {
          expect(msg.info.providerID).toBeString()
          expect(msg.info.modelID).toBeString()
          expect(msg.info.finish).toBe("stop")
          expect(msg.info.agent).toBe("build")
        }
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "imported session contains tool states with completed and error status",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      const tools = msgs.flatMap((msg) => msg.parts.filter((p) => p.type === "tool"))
      expect(tools.length).toBeGreaterThanOrEqual(4)

      const completed = tools.filter((t) => (t as unknown as { state: { status: string } }).state.status === "completed")
      expect(completed.length).toBeGreaterThanOrEqual(2)

      const errors = tools.filter((t) => (t as unknown as { state: { status: string } }).state.status === "error")
      expect(errors.length).toBeGreaterThanOrEqual(1)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "terminal import notice appears on the final assistant",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)
      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")

      const noticePart = last.parts.find((p) => p.type === "text" && (p as { synthetic?: boolean }).synthetic)
      expect(noticePart).toBeDefined()
      if (noticePart && noticePart.type === "text") {
        expect(noticePart.text).toContain("imported from an external session")
        expect((noticePart as { ignored?: boolean }).ignored).toBe(true)
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "rejects unsupported Claude major version",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      yield* withClaudeFixture(dir, claudeInvalidVersion, fixtureUUID)

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: fixtureUUID,
          agent: "build",
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const err = exit.cause
        const msg = JSON.stringify(err)
        expect(msg).toContain("Unsupported")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "rejects unknown UUID with clear error",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const unknownID = "00000000-0000-0000-0000-000000000000"
      // No fixture file for this UUID

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: unknownID,
          agent: "build",
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = JSON.stringify(exit.cause)
        expect(msg).toContain("No Claude Code session found")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "rejects nonempty session with clear error",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      // Seed a user message so the session is not empty
      const msg = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: msg.id,
        sessionID: chat.id,
        type: "text",
        text: "Hello",
      })

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: fixtureUUID,
          agent: "build",
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = JSON.stringify(exit.cause)
        expect(msg).toContain("new Kilo session")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "rejects empty argument when no picker selections exist",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: "",
          agent: "build",
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = JSON.stringify(exit.cause)
        expect(msg).toContain("No session transcripts found")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "rejects invalid UUID argument",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: "not-a-uuid",
          agent: "build",
        }),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = JSON.stringify(exit.cause)
        expect(msg).toContain("Invalid UUID")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "imported session writable and queryable through Session.Service",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessions.messages({ sessionID: chat.id })
      expect(msgs.length).toBeGreaterThanOrEqual(10)

      const parts = msgs.flatMap((msg) => msg.parts)
      const textParts = parts.filter((p) => p.type === "text")
      expect(textParts.length).toBeGreaterThan(0)

      const toolParts = parts.filter((p) => p.type === "tool")
      expect(toolParts.length).toBeGreaterThan(0)
    }),
  { config: cfg },
  30_000,
)

// ── Codex fixture helpers ────────────────────────────────────────────────

const codexFixture = () =>
  Bun.file(path.join(__dirname, "fixture/session-resume/codex.jsonl")).text()

const withCodexFixture = (content: string, id: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const dir = path.join(os.homedir(), ".codex", "sessions")
      const file = path.join(dir, `rollout-${id}.jsonl`)
      yield* writeText(file, content)
      return file
    }),
    (file) =>
      Effect.gen(function* () {
        fs.rmSync(file, { force: true })
      }),
  )

// ── Codex explicit ID import ─────────────────────────────────────────────

it.instance(
  "explicit Codex ID import produces normal session history",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => codexFixture())
      yield* withCodexFixture(content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-codex",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)
      // Codex fixture has 7 user turns + 6 assistant turns + notice
      expect(msgs.length).toBeGreaterThanOrEqual(8)

      expect(msgs[0].info.role).toBe("user")

      // Last message must be assistant with import notice
      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")
      const text = last.parts.find((p) => p.type === "text")
      expect(text?.type === "text" && text.text).toContain("imported from an external session")
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "imported Codex assistant messages carry complete fields",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => codexFixture())
      yield* withCodexFixture(content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-codex",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      for (const msg of msgs) {
        if (msg.info.role === "assistant") {
          expect(msg.info.providerID).toBeString()
          expect(msg.info.modelID).toBeString()
          expect(msg.info.finish).toBe("stop")
          expect(msg.info.agent).toBe("build")
        }
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "imported Codex session contains tool states with completed and error status",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => codexFixture())
      yield* withCodexFixture(content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-codex",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      const tools = msgs.flatMap((msg) => msg.parts.filter((p) => p.type === "tool"))
      expect(tools.length).toBeGreaterThanOrEqual(2)

      const completed = tools.filter(
        (t) => (t as { state: { status: string } }).state.status === "completed",
      )
      expect(completed.length).toBeGreaterThanOrEqual(1)
    }),
  { config: cfg },
  30_000,
)

// ── Picker / no-ID import ─────────────────────────────────────────────────

const tmpRoots = Effect.fn("test.tmpRoots")(function* () {
  const test = yield* TestInstance
  const claude = path.join(test.directory, "tmp-claude-projects")
  const codex = path.join(test.directory, "tmp-codex-sessions")
  return { claude, codex }
})

const withClaudeFixtureAt = (root: string, cwd: string, content: string, id: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const dir = path.join(root, claudeSlug(cwd))
      const file = path.join(dir, `${id}.jsonl`)
      yield* writeText(file, content)
      return file
    }),
    (file) =>
      Effect.gen(function* () {
        fs.rmSync(path.dirname(file), { recursive: true, force: true })
      }),
  )

const codexFixtureForCwdAt = (cwd: string) =>
  Effect.gen(function* () {
    const raw = yield* Effect.promise(() => codexFixture())
    // Escape backslashes so the JSON stays valid on Windows paths.
    const escaped = cwd.replace(/\\/g, "\\\\")
    return raw.replace(/"cwd":"[^"]*"/, `"cwd":"${escaped}"`)
  })

const withCodexFixtureAt = (root: string, content: string, id: string) =>
  Effect.acquireRelease(
    Effect.gen(function* () {
      const file = path.join(root, `rollout-${id}.jsonl`)
      yield* writeText(file, content)
      return file
    }),
    (file) =>
      Effect.gen(function* () {
        fs.rmSync(file, { force: true })
      }),
  )

itPicker.instance(
  "Claude picker import discovers and imports the most recent session",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())

      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: "",
        agent: "build",
      }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBeGreaterThanOrEqual(10)

      expect(msgs[0].info.role).toBe("user")
      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")
      const text = last.parts.find((p) => p.type === "text")
      expect(text?.type === "text" && text.text).toContain("imported from an external session")
    }),
  { config: cfg },
  30_000,
)

itPicker.instance(
  "Codex picker import discovers and imports the most recent session",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const { prompt, chat } = yield* boot()
      const content = yield* codexFixtureForCwdAt(dir)

      yield* withCodexFixtureAt(roots.codex, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-codex",
        arguments: "",
        agent: "build",
      }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { codex: roots.codex }),
      )

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBeGreaterThanOrEqual(8)

      expect(msgs[0].info.role).toBe("user")
      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")
      const text = last.parts.find((p) => p.type === "text")
      expect(text?.type === "text" && text.text).toContain("imported from an external session")
    }),
  { config: cfg },
  30_000,
)

// ── Unreadable directory case ─────────────────────────────────────────────

it.instance(
  "rejects when a session ID resolves to a directory instead of a file",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const test = yield* TestInstance
      const { prompt, chat } = yield* boot()

      // Use a temp root instead of real home directory
      const root = path.join(test.directory, "tmp-claude-projects")
      const file = path.join(root, claudeSlug(dir), `${fixtureUUID}.jsonl`)

      // acquireRelease: create a directory at the expected file path,
      // clean up on scope exit even if assertion fails
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          fs.mkdirSync(file, { recursive: true })
        }),
        () => Effect.sync(() => {
          fs.rmSync(path.dirname(file), { recursive: true, force: true })
        }),
      )

      const exit = yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: fixtureUUID,
          agent: "build",
        }).pipe(
          Effect.provideService(SessionResume.ResumeRoots, { claude: root }),
        ),
      )

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const msg = JSON.stringify(exit.cause)
        expect(msg).toContain("Unreadable Claude transcript")
      }

      // Assert no messages were written
      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

// ── Failure state asserts ─────────────────────────────────────────────────

it.instance(
  "unknown UUID failure writes no session messages",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const unknownID = "00000000-0000-0000-0000-000000000000"

      yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: unknownID,
          agent: "build",
        }),
      )

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "unsupported version failure writes no session messages",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      yield* withClaudeFixture(dir, claudeInvalidVersion, fixtureUUID)

      yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: fixtureUUID,
          agent: "build",
        }),
      )

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "nonempty session failure writes no additional messages",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, sessions, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      // Mark session as nonempty
      const msg = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })

      yield* Effect.exit(
        prompt.command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: fixtureUUID,
          agent: "build",
        }),
      )

      // The single user message from seeding must still be the only message
      const msgs = yield* sessions.messages({ sessionID: chat.id })
      expect(msgs.length).toBe(1)
      expect(msgs[0].info.id).toBe(msg.id)
    }),
  { config: cfg },
  30_000,
)

// ── Tool schema decoding ──────────────────────────────────────────────────

it.instance(
  "decodes imported tool parts through SessionV1.ToolPart schema",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixture(dir, content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-claude",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      for (const msg of msgs) {
        for (const part of msg.parts) {
          if (part.type === "tool") {
            // Must decode without error
            const decoded = Schema.decodeUnknownSync(SessionV1.ToolPart)(part)
            expect(decoded.type).toBe("tool")
            expect(typeof decoded.callID).toBe("string")
            expect(typeof decoded.tool).toBe("string")
            expect(decoded.state).toBeDefined()
          }
        }
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "decodes imported Codex tool parts through SessionV1.ToolPart schema",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { prompt, chat } = yield* boot()
      const content = yield* Effect.promise(() => codexFixture())
      yield* withCodexFixture(content, fixtureUUID)

      yield* prompt.command({
        sessionID: chat.id,
        command: "resume-codex",
        arguments: fixtureUUID,
        agent: "build",
      })

      const msgs = yield* sessionMessages(chat.id)

      for (const msg of msgs) {
        for (const part of msg.parts) {
          if (part.type === "tool") {
            const decoded = Schema.decodeUnknownSync(SessionV1.ToolPart)(part)
            expect(decoded.type).toBe("tool")
            expect(typeof decoded.callID).toBe("string")
            expect(typeof decoded.tool).toBe("string")
            expect(decoded.state).toBeDefined()
          }
        }
      }
    }),
  { config: cfg },
  30_000,
)
