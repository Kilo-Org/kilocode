import path from "node:path"
import os from "node:os"
import fs from "node:fs"
import { expect } from "bun:test"
import { Effect, Exit, Layer, Schema } from "effect"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
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
import { MessageV2 } from "../../src/session/message-v2"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { SessionResume } from "../../src/kilocode/session-resume"
import { SessionResumeImport } from "../../src/kilocode/session-resume/import"
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

const base = [
  [SessionSummary.node, summary],
  [LSP.node, lsp],
  [MCP.node, mcp],
  [RuntimeFlags.node, RuntimeFlags.layer({ experimentalEventSystem: true })],
  [KiloSessions.node, KiloSessions.testLayer],
] as const

const replacements = [...base, [AgentSvc.node, fastAgents]] as const

const it = testEffect(LayerNode.compile(root, replacements))

// Same stack but with the real Agent service, so agent resolution behaves like
// production (unknown names resolve to undefined instead of the mocked agent).
const itAgents = testEffect(LayerNode.compile(root, base))

const picker = Layer.mock(Question.Service, {
  ask: (input) =>
    Effect.gen(function* () {
      const q = input.questions[0]
      if (!q) return [] as readonly string[][]
      const label = q.options?.[0]?.label ?? ""
      return [[label]]
    }),
})
const itPicker = testEffect(LayerNode.compile(root, [...replacements, [Question.node, picker]]))

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

const claudeFixture = () => Bun.file(path.join(__dirname, "fixture/session-resume/claude.jsonl")).text()

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

      const completed = tools.filter(
        (t) => (t as unknown as { state: { status: string } }).state.status === "completed",
      )
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

const codexFixture = () => Bun.file(path.join(__dirname, "fixture/session-resume/codex.jsonl")).text()

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

      const completed = tools.filter((t) => (t as { state: { status: string } }).state.status === "completed")
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

      yield* prompt
        .command({
          sessionID: chat.id,
          command: "resume-claude",
          arguments: "",
          agent: "build",
        })
        .pipe(Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }))

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

      yield* prompt
        .command({
          sessionID: chat.id,
          command: "resume-codex",
          arguments: "",
          agent: "build",
        })
        .pipe(Effect.provideService(SessionResume.ResumeRoots, { codex: roots.codex }))

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
        () =>
          Effect.sync(() => {
            fs.rmSync(path.dirname(file), { recursive: true, force: true })
          }),
      )

      const exit = yield* Effect.exit(
        prompt
          .command({
            sessionID: chat.id,
            command: "resume-claude",
            arguments: fixtureUUID,
            agent: "build",
          })
          .pipe(Effect.provideService(SessionResume.ResumeRoots, { claude: root })),
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

// ── SessionResumeImport.fromContent (shared endpoint logic) ───────────────
//
// The HTTP endpoint (POST /kilocode/migrate/sessions) passes raw JSONL content
// straight to SessionResumeImport.fromContent. These tests exercise that shared
// entry point directly — no file discovery, no slash command — since that is the
// path every thin client (VS Code, CLI) uses through the server.

it.instance(
  "fromContent imports raw Claude JSONL into an empty session",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())

      const result = yield* SessionResumeImport.fromContent({
        sessionID: chat.id,
        content,
        agent: "build",
      })

      expect(result.format).toBe("claude")
      expect(result.messages).toBeGreaterThanOrEqual(10)
      expect(typeof result.messageID).toBe("string")

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBeGreaterThanOrEqual(10)
      expect(msgs[0].info.role).toBe("user")

      const last = msgs[msgs.length - 1]
      expect(last.info.role).toBe("assistant")
      expect(last.info.id).toBe(result.messageID)
      const notice = last.parts.find((p) => p.type === "text")
      expect(notice?.type === "text" && notice.text).toContain("imported from an external session")

      // Imported tool parts must decode through the canonical SessionV1 schema.
      const tools = msgs.flatMap((m) => m.parts.filter((p) => p.type === "tool"))
      expect(tools.length).toBeGreaterThan(0)
      for (const part of tools) {
        const decoded = Schema.decodeUnknownSync(SessionV1.ToolPart)(part)
        expect(decoded.type).toBe("tool")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "fromContent imports raw Codex JSONL into an empty session",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()
      const content = yield* Effect.promise(() => codexFixture())

      const result = yield* SessionResumeImport.fromContent({
        sessionID: chat.id,
        content,
        agent: "build",
      })

      expect(result.format).toBe("codex")
      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBeGreaterThanOrEqual(8)
      expect(msgs[0].info.role).toBe("user")
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "fromContent rejects a nonempty session and writes nothing",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { sessions, chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())

      const seeded = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "user",
        sessionID: chat.id,
        agent: "build",
        model: ref,
        time: { created: Date.now() },
      })

      const exit = yield* Effect.exit(SessionResumeImport.fromContent({ sessionID: chat.id, content, agent: "build" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("new Kilo session")
      }

      const msgs = yield* sessions.messages({ sessionID: chat.id })
      expect(msgs.length).toBe(1)
      expect(msgs[0].info.id).toBe(seeded.id)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "fromContent rejects a transcript with no user messages",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()
      const content = [
        '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
      ].join("\n")

      const exit = yield* Effect.exit(SessionResumeImport.fromContent({ sessionID: chat.id, content, agent: "build" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("no user messages")
      }

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "fromContent rejects a session that does not exist and creates nothing",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const sessions = yield* Session.Service
      const content = yield* Effect.promise(() => claudeFixture())
      const missing = SessionID.make("ses_missing_import_target")

      const exit = yield* Effect.exit(SessionResumeImport.fromContent({ sessionID: missing, content, agent: "build" }))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("Session not found")
      }

      // The import must not have conjured the session into existence.
      expect(Exit.isFailure(yield* Effect.exit(sessions.get(missing)))).toBe(true)
    }),
  { config: cfg },
  30_000,
)

itAgents.instance(
  "fromContent rejects an unknown agent and writes nothing",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()
      const content = yield* Effect.promise(() => claudeFixture())

      const exit = yield* Effect.exit(
        SessionResumeImport.fromContent({ sessionID: chat.id, content, agent: "no-such-agent" }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("Agent not found")
      }

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "fromContent rejects unparseable transcript content",
  () =>
    Effect.gen(function* () {
      yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()

      const exit = yield* Effect.exit(
        SessionResumeImport.fromContent({ sessionID: chat.id, content: "{not json", agent: "build" }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("Failed to parse session transcript")
      }

      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

// ── SessionResumeImport.discover (discovery endpoint logic) ───────────────
//
// The HTTP endpoint (POST /kilocode/migrate/sessions/discover) delegates to
// SessionResumeImport.discover. These tests drive that shared entry point
// directly with fixtures written under redirected discovery roots (via the
// ResumeRoots test seam), the same seam the slash-command picker uses. Discovery
// must never write to any session.

it.instance(
  "discover enumerates a Claude transcript with a preview",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const result = yield* SessionResumeImport.discover({ cwd: dir, formats: ["claude"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )

      expect(result.sessions.length).toBe(1)
      const entry = result.sessions[0]
      expect(entry.id).toBe(fixtureUUID)
      expect(entry.format).toBe("claude")
      expect(entry.path).toContain(`${fixtureUUID}.jsonl`)
      expect(entry.messages).toBeGreaterThanOrEqual(10)
      expect(entry.version).toBe(SessionResume.SUPPORTED_CLAUDE_MAJOR)
      expect(typeof entry.title).toBe("string")
      expect((entry.title ?? "").length).toBeGreaterThan(0)
      expect(entry.mtime).toBeGreaterThan(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "discover enumerates a Codex transcript with a preview",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const content = yield* codexFixtureForCwdAt(dir)
      yield* withCodexFixtureAt(roots.codex, content, fixtureUUID)

      const result = yield* SessionResumeImport.discover({ cwd: dir, formats: ["codex"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { codex: roots.codex }),
      )

      expect(result.sessions.length).toBe(1)
      const entry = result.sessions[0]
      expect(entry.id).toBe(fixtureUUID)
      expect(entry.format).toBe("codex")
      expect(entry.messages).toBeGreaterThanOrEqual(8)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "discover returns both formats sorted most-recent-first",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const claude = yield* Effect.promise(() => claudeFixture())
      const codex = yield* codexFixtureForCwdAt(dir)

      const claudeID = "11111111-1111-4111-8111-111111111111"
      const codexID = "22222222-2222-4222-8222-222222222222"

      yield* withClaudeFixtureAt(roots.claude, dir, claude, claudeID)
      // Make the Codex transcript newer so it sorts first.
      const codexFile = yield* withCodexFixtureAt(roots.codex, codex, codexID)
      yield* Effect.sync(() => {
        const now = Date.now()
        fs.utimesSync(codexFile, new Date(now), new Date(now))
      })

      const result = yield* SessionResumeImport.discover({ cwd: dir }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude, codex: roots.codex }),
      )

      const ids = result.sessions.map((s) => s.id)
      expect(ids).toContain(claudeID)
      expect(ids).toContain(codexID)
      // Sorted descending by mtime.
      for (let i = 1; i < result.sessions.length; i++) {
        expect(result.sessions[i - 1].mtime).toBeGreaterThanOrEqual(result.sessions[i].mtime)
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "discover returns an empty list when no transcripts exist",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()

      const result = yield* SessionResumeImport.discover({ cwd: dir }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude, codex: roots.codex }),
      )

      expect(result.sessions.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "discover skips unparseable transcripts and reports them as dropped, writing nothing",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const { chat } = yield* boot()
      const roots = yield* tmpRoots()

      const goodID = "33333333-3333-4333-8333-333333333333"
      const badID = "44444444-4444-4444-8444-444444444444"
      const good = yield* Effect.promise(() => claudeFixture())

      yield* withClaudeFixtureAt(roots.claude, dir, good, goodID)
      yield* withClaudeFixtureAt(roots.claude, dir, claudeInvalidVersion, badID)

      const result = yield* SessionResumeImport.discover({ cwd: dir, formats: ["claude"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )

      const ids = result.sessions.map((s) => s.id)
      expect(ids).toContain(goodID)
      expect(ids).not.toContain(badID)
      expect(result.dropped.some((d) => d.includes(badID))).toBe(true)

      // Discovery is read-only: the caller's session stays empty.
      const msgs = yield* sessionMessages(chat.id)
      expect(msgs.length).toBe(0)
    }),
  { config: cfg },
  30_000,
)

// ── SessionResumeImport.migrate (migration endpoint logic) ────────────────
//
// The HTTP endpoint (POST /kilocode/migrate/sessions) delegates to
// SessionResumeImport.migrate, which re-discovers server-side, creates one Kilo
// session per transcript, and records the source on the created session so a
// second call skips it. These tests drive it through the ResumeRoots seam.

const migrateAt = (roots: { claude: string; codex: string }, input: SessionResumeImport.MigrateInput) =>
  SessionResumeImport.migrate(input).pipe(
    Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude, codex: roots.codex }),
  )

it.instance(
  "migrate creates a session per discovered transcript and records the source",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const result = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })

      expect(result.migrated).toBe(1)
      expect(result.skipped).toBe(0)
      const entry = result.sessions[0]
      expect(entry.id).toBe(fixtureUUID)
      expect(entry.format).toBe("claude")
      expect(entry.skipped).toBe(false)
      expect(entry.error).toBeUndefined()
      expect(entry.messages).toBeGreaterThanOrEqual(10)

      // The transcript landed in the session the result points at.
      expect(entry.sessionID).toBeString()
      const created = SessionID.make(entry.sessionID ?? "")
      const msgs = yield* sessionMessages(created)
      expect(msgs.length).toBeGreaterThanOrEqual(10)
      expect(msgs[0].info.role).toBe("user")
      expect(entry.messageID).toBe(msgs.at(-1)?.info.id)

      // Provenance is persisted on the session, which is what makes a rerun a no-op.
      const info = yield* sessions.get(created)
      expect(info.metadata?.migrate).toMatchObject({ format: "claude", id: fixtureUUID })
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "migrate is a no-op on the second call",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const first = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })
      expect(first.migrated).toBe(1)
      const before = (yield* sessions.list()).length

      const second = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })

      expect(second.migrated).toBe(0)
      expect(second.skipped).toBe(1)
      expect(second.sessions[0].skipped).toBe(true)
      // Points at the session from the first run rather than a new one.
      expect(second.sessions[0].sessionID).toBe(first.sessions[0].sessionID)
      expect((yield* sessions.list()).length).toBe(before)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "migrate still skips a source once its session falls outside the recent-session page",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const first = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })
      expect(first.migrated).toBe(1)

      // Session.list pages to the 100 most recently updated sessions. Push the
      // migrated session out of that window; the marker must still be found or
      // the transcript gets migrated a second time.
      for (let i = 0; i < 101; i++) {
        yield* sessions.create({ title: `filler ${i}` })
      }

      const found = yield* SessionResumeImport.discover({ cwd: dir, formats: ["claude"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )
      expect(found.sessions[0].sessionID).toBe(first.sessions[0].sessionID)

      const second = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })
      expect(second.migrated).toBe(0)
      expect(second.skipped).toBe(1)
      expect(second.sessions[0].sessionID).toBe(first.sessions[0].sessionID)
    }),
  { config: cfg },
  60_000,
)

it.instance(
  "migrate with force re-migrates an already migrated source",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const first = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })
      const before = (yield* sessions.list()).length

      const forced = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build", force: true })

      expect(forced.migrated).toBe(1)
      expect(forced.skipped).toBe(0)
      expect(forced.sessions[0].sessionID).not.toBe(first.sessions[0].sessionID)
      expect((yield* sessions.list()).length).toBe(before + 1)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "discover marks sources that were already migrated",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const content = yield* Effect.promise(() => claudeFixture())
      yield* withClaudeFixtureAt(roots.claude, dir, content, fixtureUUID)

      const before = yield* SessionResumeImport.discover({ cwd: dir, formats: ["claude"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )
      expect(before.sessions[0].sessionID).toBeUndefined()

      const result = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })

      const after = yield* SessionResumeImport.discover({ cwd: dir, formats: ["claude"] }).pipe(
        Effect.provideService(SessionResume.ResumeRoots, { claude: roots.claude }),
      )
      expect(after.sessions[0].sessionID).toBe(result.sessions[0].sessionID)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "migrate only touches the requested ids and rejects unknown ones",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const content = yield* Effect.promise(() => claudeFixture())
      const wanted = "55555555-5555-4555-8555-555555555555"
      const other = "66666666-6666-4666-8666-666666666666"
      yield* withClaudeFixtureAt(roots.claude, dir, content, wanted)
      yield* withClaudeFixtureAt(roots.claude, dir, content, other)

      const result = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build", ids: [wanted] })
      expect(result.sessions.length).toBe(1)
      expect(result.sessions[0].id).toBe(wanted)

      const exit = yield* Effect.exit(
        migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build", ids: ["not-a-known-id"] }),
      )
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        expect(JSON.stringify(exit.cause)).toContain("No Claude Code or OpenAI Codex session found")
      }
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "migrate reports a bad transcript per entry and leaves no session behind",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const good = yield* Effect.promise(() => claudeFixture())
      const goodID = "77777777-7777-4777-8777-777777777777"
      const badID = "88888888-8888-4888-8888-888888888888"

      yield* withClaudeFixtureAt(roots.claude, dir, good, goodID)
      // Parses as Claude but carries no user text, so it is rejected before any write.
      yield* withClaudeFixtureAt(
        roots.claude,
        dir,
        '{"type":"assistant","version":"2.42.0","message":{"role":"assistant","content":[{"type":"text","text":"Hi"}]}}',
        badID,
      )

      const before = (yield* sessions.list()).length
      const result = yield* migrateAt(roots, { cwd: dir, formats: ["claude"], agent: "build" })

      expect(result.migrated).toBe(1)
      const bad = result.sessions.find((item) => item.id === badID)
      expect(bad?.error).toContain("no user messages")
      expect(bad?.sessionID).toBeUndefined()
      // Exactly one new session: the good transcript, nothing for the bad one.
      expect((yield* sessions.list()).length).toBe(before + 1)
    }),
  { config: cfg },
  30_000,
)

it.instance(
  "migrate is a no-op when nothing is discovered",
  () =>
    Effect.gen(function* () {
      const { dir } = yield* useServerConfig(providerCfg)
      const roots = yield* tmpRoots()
      const sessions = yield* Session.Service
      const before = (yield* sessions.list()).length

      const result = yield* migrateAt(roots, { cwd: dir, agent: "build" })

      expect(result.sessions.length).toBe(0)
      expect(result.migrated).toBe(0)
      expect(result.skipped).toBe(0)
      expect((yield* sessions.list()).length).toBe(before)
    }),
  { config: cfg },
  30_000,
)
