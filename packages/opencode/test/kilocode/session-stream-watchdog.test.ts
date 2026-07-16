import { NodeFileSystem } from "@effect/platform-node"
import { afterEach, describe, expect } from "bun:test"
import { Effect, Exit, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs from "fs/promises"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import type { SessionID } from "../../src/session/schema"
import path from "path"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Log from "@opencode-ai/core/util/log"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Auth } from "../../src/auth"
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
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

void Log.init({ print: false })

afterEach(async () => {
  // Dispose all test instances between integration scenarios.
  const { disposeAllInstances } = await import("../fixture/fixture")
  await disposeAllInstances()
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
    startAuth: () => Effect.die("unexpected MCP auth in watchdog tests"),
    authenticate: () => Effect.die("unexpected MCP auth in watchdog tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in watchdog tests"),
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
    Plugin.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    Reference.defaultLayer,
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
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Auth.defaultLayer),
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
          options: { chunkTimeout: 1_000 },
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
          chunkTimeout: false as const,
        },
      },
    },
  }
}

const worktreeFile = (dir: string, name: string) => path.join(dir, name)

const exists = (file: string) =>
  Effect.promise(() =>
    fs
      .access(file)
      .then(() => true)
      .catch(() => false),
  )

// The production bash tool runs every command through a *login* shell
// (`bash -l -c ...`, see src/shell/shell.ts) so `~/.bashrc` and shell
// aliases behave the same as an interactive terminal. Git for Windows'
// login-shell startup rescans the full Windows `PATH` and is well known to
// take several seconds on CI hardware — well beyond what a Unix login shell
// costs — before it even reaches the `touch` in `bashGate`. Give the marker
// file these tests poll for a generous margin there. Matches the existing
// platform-aware timeout doubling in test/kilocode/background-process.test.ts.
const waitForFile = (file: string, label: string, duration = process.platform === "win32" ? 30_000 : 5_000) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const ok = yield* exists(file)
      return ok ? true : undefined
    }),
    label,
    duration,
  )

const touch = (file: string) => Effect.promise(() => fs.writeFile(file, ""))

const waitForRunningTool = (sessionID: SessionID, sessions: Session.Interface, label: string, duration = 15_000) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const msgs = yield* sessions.messages({ sessionID })
      const running = msgs
        .flatMap((msg) => msg.parts)
        .find((part) => part.type === "tool" && part.state.status === "running")
      return running ? running : undefined
    }),
    label,
    duration,
  )

const waitForRequestHit = (llm: TestLLMServer["Service"], needle: string, label: string) =>
  pollWithTimeout(
    Effect.gen(function* () {
      const hits = yield* llm.hits
      const matched = hits.filter((hit) => JSON.stringify(hit.body).includes(needle))
      return matched.length > 0 ? matched : undefined
    }),
    label,
    5_000,
  )

const matchContains = (needle: string) => (hit: { body: Record<string, unknown> }) =>
  JSON.stringify(hit.body).includes(needle)

const assertNotInterrupted = (parts: SessionV1.WithParts["parts"]) => {
  for (const part of parts) {
    if (part.type === "tool") {
      expect(part.state.status).toBe("completed")
      if (part.state.status === "completed") {
        expect(part.state.metadata?.interrupted).not.toBe(true)
        expect(part.state.output).not.toContain("Tool execution aborted")
      }
    }
  }
}

// kilocode_change: normalize to forward slashes before embedding in the
// shell script. `ready`/`release` come from `path.join`, which yields
// backslash-separated paths on Windows; inside a double-quoted git-bash
// string a literal backslash is an escape character, so a Windows path can
// silently mangle into the wrong filename (or a path bash's `[ -f ... ]`
// test can't resolve) rather than throwing. Git-bash/MSYS accept
// forward-slash paths natively, so this is safe on every platform this
// suite runs on.
const posixPath = (p: string) => p.replaceAll("\\", "/")

const bashGate = (dir: string, ready: string, release: string) =>
  `touch ${JSON.stringify(posixPath(ready))} && while [ ! -f ${JSON.stringify(posixPath(release))} ]; do sleep 0.05; done && echo done`

describe("session stream watchdog integration", () => {
  it.live(
    "A: root session long-running Bash is not interrupted by the idle watchdog",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "Root long bash" })
          const ready = worktreeFile(dir, "bash-ready")
          const release = worktreeFile(dir, "bash-release")

          yield* llm.tool("bash", {
            command: bashGate(dir, ready, release),
            description: "Long running bash command",
            timeout: 60_000,
            workdir: dir,
          })
          yield* llm.text("bash complete")

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "run a long bash command" }],
          })

          const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

          yield* llm.wait(1)
          yield* waitForRunningTool(chat.id, sessions, "root bash tool never started")
          yield* waitForFile(ready, "root bash readiness marker never appeared")
          yield* Effect.sleep("1500 millis")

          yield* touch(release)

          const exit = yield* awaitWithTimeout(Fiber.await(fiber), "root bash loop did not finish", "15 seconds")
          expect(Exit.isSuccess(exit)).toBe(true)

          // Check all messages in the session for interrupted tools
          const allMessages = yield* sessions.messages({ sessionID: chat.id })
          for (const msg of allMessages) {
            assertNotInterrupted(msg.parts)
          }
        }),
        { git: true, config: (url) => ({ ...providerCfg(url), permission: { bash: "allow" } }) },
      ),
    // kilocode_change: extended on Windows to cover the slow login-shell
    // startup described on waitForFile above.
    { timeout: process.platform === "win32" ? 90_000 : 30_000 },
  )

  it.live(
    "B: root foreground TaskTool child with held LLM response is not interrupted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "Root foreground child" })
          const gate = Promise.withResolvers<void>()

          yield* llm.tool("task", {
            description: "Foreground child task",
            prompt: "child task: say hello",
            subagent_type: "child",
          })
          yield* llm.pushMatch(
            matchContains("child task: say hello"),
            reply().wait(gate.promise).text("child done").stop(),
          )
          yield* llm.text("parent done")

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "run a foreground child" }],
          })

          const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

          yield* llm.wait(1)
          yield* waitForRunningTool(chat.id, sessions, "root task tool never started")
          yield* waitForRequestHit(llm, "child task: say hello", "child LLM request never hit server")
          yield* Effect.sleep("1500 millis")

          gate.resolve(undefined)

          const exit = yield* awaitWithTimeout(
            Fiber.await(fiber),
            "root foreground child loop did not finish",
            "15 seconds",
          )
          expect(Exit.isSuccess(exit)).toBe(true)

          // Check all messages in root and child sessions for interrupted tools
          const allMessages = yield* sessions.messages({ sessionID: chat.id })
          for (const msg of allMessages) {
            assertNotInterrupted(msg.parts)
          }

          const children = yield* sessions.children(chat.id)
          expect(children).toHaveLength(1)
          const childMessages = yield* sessions.messages({ sessionID: children[0]!.id })
          for (const msg of childMessages) {
            assertNotInterrupted(msg.parts)
          }
        }),
        {
          git: true,
          config: (url) => ({
            ...providerCfg(url),
            permission: { bash: "allow", task: "allow" },
            agent: {
              child: {
                model: "test/test-model",
                mode: "subagent",
                options: { chunkTimeout: false },
                permission: { bash: "allow", task: "allow" },
              },
            },
          }),
        },
      ),
    { timeout: 30_000 },
  )

  it.live(
    "C: child session long-running Bash while root awaits it is not interrupted",
    () =>
      provideTmpdirServer(
        Effect.fnUntraced(function* ({ dir, llm }) {
          const prompt = yield* SessionPrompt.Service
          const sessions = yield* Session.Service
          const chat = yield* sessions.create({ title: "Nested long bash" })
          const ready = worktreeFile(dir, "child-bash-ready")
          const release = worktreeFile(dir, "child-bash-release")

          yield* llm.tool("task", {
            description: "Nested child task",
            prompt: "child task: run a long bash command",
            subagent_type: "child",
          })
          yield* llm.pushMatch(
            matchContains("child task: run a long bash command"),
            reply().tool("bash", {
              command: bashGate(dir, ready, release),
              description: "Long running child bash command",
              timeout: 60_000,
              workdir: dir,
            }),
          )
          yield* llm.text("child done")
          yield* llm.text("parent done")

          yield* prompt.prompt({
            sessionID: chat.id,
            agent: "build",
            noReply: true,
            parts: [{ type: "text", text: "run a nested child" }],
          })

          const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkChild)

          yield* llm.wait(1)
          yield* waitForRunningTool(chat.id, sessions, "root task tool never started")
          yield* waitForRequestHit(llm, "child task: run a long bash command", "child LLM request never hit server")

          const children = yield* sessions.children(chat.id)
          expect(children).toHaveLength(1)
          const childID = children[0]!.id

          yield* waitForRunningTool(childID, sessions, "child bash tool never started")
          yield* waitForFile(ready, "child bash readiness marker never appeared")
          yield* Effect.sleep("1500 millis")

          yield* touch(release)

          const exit = yield* awaitWithTimeout(
            Fiber.await(fiber),
            "nested child bash loop did not finish",
            "15 seconds",
          )
          expect(Exit.isSuccess(exit)).toBe(true)

          // Check all messages in root and child sessions for interrupted tools
          const rootMessages = yield* sessions.messages({ sessionID: chat.id })
          for (const msg of rootMessages) {
            assertNotInterrupted(msg.parts)
          }

          // Reuse childID captured above
          const childMessages = yield* sessions.messages({ sessionID: childID })
          for (const msg of childMessages) {
            assertNotInterrupted(msg.parts)
          }
        }),
        {
          git: true,
          config: (url) => ({
            ...providerCfg(url),
            permission: { bash: "allow", task: "allow" },
            agent: {
              child: {
                model: "test/test-model",
                mode: "subagent",
                permission: { bash: "allow", task: "allow" },
              },
            },
          }),
        },
      ),
    // kilocode_change: extended on Windows, see the matching comment on test A.
    { timeout: process.platform === "win32" ? 90_000 : 30_000 },
  )
})
