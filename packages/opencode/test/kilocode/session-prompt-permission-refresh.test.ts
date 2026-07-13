import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs from "fs/promises"
import path from "path"
import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Auth } from "../../src/auth" // kilocode_change
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Env } from "../../src/env"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
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
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import { Ripgrep } from "../../src/file/ripgrep"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloHeadless } from "../../src/kilocode/permission/headless"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

void Log.init({ print: false })

const waitFor = <A, E, R>(label: string, run: Effect.Effect<A | undefined, E, R>) =>
  Effect.gen(function* () {
    const end = Date.now() + 5_000
    while (Date.now() < end) {
      const result = yield* run
      if (result !== undefined) return result
      yield* Effect.sleep(20)
    }
    throw new Error(`timed out waiting for ${label}`)
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
    startAuth: () => Effect.die("unexpected MCP auth in permission refresh tests"),
    authenticate: () => Effect.die("unexpected MCP auth in permission refresh tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in permission refresh tests"),
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
    EventV2Bridge.defaultLayer,
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
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Auth.defaultLayer), // kilocode_change
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
        Reference.defaultLayer,
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

it.live("global skill shell access can be approved permanently", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ llm }) {
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const skill = path.join(Global.Path.config, "skills", "permission-self-test")
      const pattern = path.join(skill, "*").replaceAll("\\", "/")
      const call = { command: "pwd", workdir: skill, description: "Run global skill resource" }

      yield* Effect.promise(() => fs.mkdir(skill, { recursive: true }))
      yield* llm.push(reply().tool("bash", call), reply().text("first complete").stop())

      const chat = yield* sessions.create({ title: "Global skill permission" })
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run the skill" }],
      })
      const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)

      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.find((item) => item.sessionID === chat.id)
        }),
        "global skill permission was never surfaced",
      )
      expect(pending?.permission).toBe("external_directory")
      const always = (pending?.always ?? []) as string[]
      expect(always).toHaveLength(1)
      expect(always[0]).toMatch(/skills\/permission-self-test\/\*$/)
      const rules = (pending?.metadata?.rules ?? []) as string[]
      expect(rules).toHaveLength(1)
      expect(rules[0]).toMatch(/skills\/permission-self-test\/\*$/)
      expect(pending.metadata).not.toMatchObject({ disableAlways: true, configProtected: true })

      yield* permission.reply({ requestID: pending.id, reply: "always" })
      expect(Exit.isSuccess(yield* awaitWithTimeout(Fiber.await(first), "first global skill run did not finish"))).toBe(
        true,
      )

      yield* llm.push(reply().tool("bash", call), reply().text("second complete").stop())
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "run the skill again" }],
      })
      const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)
      expect(
        Exit.isSuccess(yield* awaitWithTimeout(Fiber.await(second), "trusted global skill prompted a second time")),
      ).toBe(true)
      expect(yield* permission.list()).toEqual([])
    }),
    {
      git: true,
      config: (url) => ({
        ...providerCfg(url),
        permission: { bash: "allow", external_directory: "allow" },
      }),
    },
  ),
)

it.live("active tool calls use permissions changed after model streaming starts", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const config = yield* Config.Service
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const file = path.join(dir, "note.txt")
      const gate = Promise.withResolvers<void>()

      yield* Effect.promise(() => Bun.write(file, "old"))
      yield* llm.push(reply().wait(gate.promise).tool("edit", { filePath: file, oldString: "old", newString: "new" }))

      const chat = yield* sessions.create({ title: "Pinned" })
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "edit note" }],
      })

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)
      yield* llm.wait(1)
      yield* config.update({ permission: { edit: { "*": "allow" } } } as Config.Info)
      gate.resolve(undefined)

      yield* waitFor(
        "edit without permission prompt",
        Effect.gen(function* () {
          const pending = yield* permission.list()
          if (pending.length) throw new Error("edit permission was requested after config allowed it")
          const text = yield* Effect.promise(() => Bun.file(file).text())
          if (text === "new") return text
        }),
      )

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
    {
      git: true,
      config: (url) => ({
        ...providerCfg(url),
        permission: { edit: "ask" },
      }),
    },
  ),
)

const worker = (mode: "subagent" | "all"): AgentSvc.Info => ({
  name: "worker",
  mode,
  permission: Permission.fromConfig({ bash: "ask" }),
  options: {},
})

const bash = (sessionID: Session.Info["id"]) => ({
  sessionID,
  permission: "bash",
  patterns: ["echo 1"],
  always: ["echo 1"],
  metadata: {},
})

// Reproduces #11903: a sync subagent hitting an "ask" rule in a headless run
// used to block forever on a permission prompt no client would ever answer.
it.live("headless run: subagent permission asks fail instead of waiting forever", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      const child = yield* sessions.create({ parentID: root.id, title: "Subagent" })
      KiloHeadless.mark(root.id)

      // mode "all" agents are valid subagents too; the deny must not key off agent mode
      const agent = worker("all")
      const err = yield* awaitWithTimeout(
        KiloSessionPrompt.askPermission({
          permission,
          agents: { get: () => Effect.succeed(agent) },
          sessions,
          agent,
          session: child,
          request: bash(child.id),
        }).pipe(Effect.flip),
        "subagent permission ask queued waiting for a human reply instead of failing",
      )

      expect(err).toBeInstanceOf(Permission.DeniedError)
      expect(yield* permission.list()).toEqual([])
      expect(KiloHeadless.denies(child.id)).toBe(true)
      expect(KiloHeadless.denies(root.id)).toBe(false)

      KiloHeadless.clear(root.id)
    }),
    { git: true },
  ),
)

it.live("interactive run: subagent permission asks still queue for a human reply", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      const child = yield* sessions.create({ parentID: root.id, title: "Subagent" })

      const agent = worker("subagent")
      const fiber = yield* KiloSessionPrompt.askPermission({
        permission,
        agents: { get: () => Effect.succeed(agent) },
        sessions,
        agent,
        session: child,
        request: bash(child.id),
      }).pipe(Effect.forkScoped)

      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.find((item) => item.sessionID === child.id)
        }),
        "subagent permission ask was never surfaced",
      )
      yield* permission.reply({ requestID: pending.id, reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
    { git: true },
  ),
)

it.live("headless run: root session permission asks still queue (only subagents fail)", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      KiloHeadless.mark(root.id)

      const agent = { ...worker("subagent"), mode: "primary" as const }
      const fiber = yield* KiloSessionPrompt.askPermission({
        permission,
        agents: { get: () => Effect.succeed(agent) },
        sessions,
        agent,
        session: root,
        request: bash(root.id),
      }).pipe(Effect.forkScoped)

      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.find((item) => item.sessionID === root.id)
        }),
        "root permission ask was never surfaced",
      )
      yield* permission.reply({ requestID: pending.id, reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      KiloHeadless.clear(root.id)
    }),
    { git: true },
  ),
)
