import { expect } from "bun:test"
import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Deferred, Effect, Fiber, Layer } from "effect"
import * as Stream from "effect/Stream"
import { FetchHttpClient } from "effect/unstable/http"
import path from "path"
import { Agent as AgentSvc } from "../../../src/agent/agent"
import { Auth } from "../../../src/auth"
import { BackgroundJob } from "../../../src/background/job"
import { Bus } from "../../../src/bus"
import { Command } from "../../../src/command"
import { Config } from "../../../src/config/config"
import { Env } from "../../../src/env"
import { EventV2Bridge } from "../../../src/event-v2-bridge"
import { Format } from "../../../src/format"
import { Git } from "../../../src/git"
import { Image } from "../../../src/image/image"
import { clearAll as clearRenameMarks, consumeAutoTitle, markAutoTitle } from "../../../src/kilo-sessions/rename-adoptions"
import { KiloSessions } from "../../../src/kilo-sessions/kilo-sessions"
import { LSP } from "../../../src/lsp/lsp"
import { MCP } from "../../../src/mcp"
import { Permission } from "../../../src/permission"
import { Plugin } from "../../../src/plugin"
import { Provider as ProviderSvc } from "../../../src/provider/provider"
import { Question } from "../../../src/question"
import { Instruction } from "../../../src/session/instruction"
import { LLM } from "../../../src/session/llm"
import { SessionCompaction } from "../../../src/session/compaction"
import { SessionProcessor } from "../../../src/session/processor"
import { SessionPrompt } from "../../../src/session/prompt"
import { SessionRevert } from "../../../src/session/revert"
import { SessionRunState } from "../../../src/session/run-state"
import { Session } from "../../../src/session/session"
import { SessionStatus } from "../../../src/session/status"
import { SessionSummary } from "../../../src/session/summary"
import { SystemPrompt } from "../../../src/session/system"
import { Todo } from "../../../src/session/todo"
import { Skill } from "../../../src/skill"
import { Snapshot } from "../../../src/snapshot"
import { ToolRegistry } from "../../../src/tool/registry"
import { Truncate } from "../../../src/tool/truncate"
import { RuntimeFlags } from "../../../src/effect/runtime-flags"
import { TestInstance } from "../../fixture/fixture"
import { pollWithTimeout, testEffect } from "../../lib/effect"
import { TestLLMServer } from "../../lib/llm-server"

// Drives the real SessionPrompt.ensureTitle path (forked on loop step 1) for:
// - mid-generation non-default skip (re-check before mark/setTitle)
// - mark-before-setTitle + clear mark when setTitle fails

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

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

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const status = SessionStatus.layer.pipe(Layer.provideMerge(EventV2Bridge.defaultLayer))
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

/** Shared mutable hooks for ensureTitle integration tests. */
const hooks = {
  stallTitle: undefined as Deferred.Deferred<void> | undefined,
  titleStreamEntered: false,
  failSetTitle: false,
  setTitleCalls: [] as { sessionID: string; title: string }[],
}

const llmWrapped = Layer.effect(
  LLM.Service,
  Effect.gen(function* () {
    const inner = yield* LLM.Service
    return {
      stream: (input: Parameters<LLM.Interface["stream"]>[0]) => {
        if (input.agent.name === "title" && hooks.stallTitle) {
          hooks.titleStreamEntered = true
          const gate = hooks.stallTitle
          return Stream.unwrap(
            Effect.gen(function* () {
              yield* Deferred.await(gate)
              return inner.stream(input)
            }),
          )
        }
        return inner.stream(input)
      },
    } satisfies LLM.Interface
  }),
).pipe(Layer.provide(LLM.defaultLayer))

const sessionWrapped = Layer.effect(
  Session.Service,
  Effect.gen(function* () {
    const inner = yield* Session.Service
    return {
      ...inner,
      setTitle: (input: { sessionID: Session.Info["id"]; title: string }) =>
        Effect.gen(function* () {
          hooks.setTitleCalls.push(input)
          if (hooks.failSetTitle) {
            // Mark must already be present (mark-before-write). Consume proves it,
            // then re-mark so ensureTitle's catchCause still has something to clear.
            expect(consumeAutoTitle(input.sessionID, input.title)).toBe(true)
            markAutoTitle(input.sessionID, input.title)
            return yield* Effect.die(new Error("setTitle failed for test"))
          }
          return yield* inner.setTitle(input)
        }),
    } as Session.Interface
  }),
).pipe(Layer.provide(Session.defaultLayer))

function makePrompt() {
  const deps = Layer.mergeAll(
    sessionWrapped,
    Snapshot.defaultLayer,
    llmWrapped,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
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

const it = testEffect(Layer.mergeAll(TestLLMServer.layer, makePrompt()))

function providerCfg(url: string): Partial<ConfigV1.Info> {
  return {
    // Pin title/small generation to the TestLLMServer provider. Without this,
    // getSmallModel("test") falls through to kilo-auto/small and ensureTitle
    // never hits the local fixture (no setTitle, no E2E Title).
    small_model: "test/test-model",
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
          baseURL: url,
        },
      },
    },
  }
}

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://app.kilo.ai/config.json", ...config }),
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* () {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, providerCfg(llm.url))
  return { dir, llm }
})

function resetHooks() {
  hooks.stallTitle = undefined
  hooks.titleStreamEntered = false
  hooks.failSetTitle = false
  hooks.setTitleCalls = []
  clearRenameMarks()
}

/** Match prompt.test.ts: turn a Deferred into a thenable for TestLLMServer.hold. */
const deferredAsPromise = <A>(deferred: Deferred.Deferred<A>): PromiseLike<A> => ({
  then: (onfulfilled, onrejected) => {
    Effect.runFork(
      Deferred.await(deferred).pipe(
        Effect.match({
          onFailure: (error) => {
            onrejected?.(error)
          },
          onSuccess: (value) => {
            onfulfilled?.(value)
          },
        }),
      ),
    )
    return deferredAsPromise(deferred) as PromiseLike<never>
  },
})

it.instance(
  "ensureTitle skips write when title turns non-default mid-generation",
  () =>
    Effect.gen(function* () {
      resetHooks()
      const { llm } = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service

      const chat = yield* sessions.create({})
      expect(Session.isDefaultTitle(chat.title)).toBe(true)

      const gate = yield* Deferred.make<void>()
      hooks.stallTitle = gate

      yield* llm.text("assistant reply")

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "hello for title" }],
        })
        .pipe(Effect.forkChild)

      // Wait until ensureTitle has entered the stalled title stream.
      yield* pollWithTimeout(
        Effect.sync(() => (hooks.titleStreamEntered ? true : undefined)),
        "ensureTitle never entered title stream",
        "15 seconds",
      )

      // Mid-generation rename: title is no longer default → ensureTitle must skip setTitle.
      // Use inner path without recording (failSetTitle is false); wrap still records.
      yield* sessions.setTitle({ sessionID: chat.id, title: "User renamed mid-gen" })
      yield* Deferred.succeed(gate, undefined).pipe(Effect.ignore)
      hooks.stallTitle = undefined

      yield* Fiber.join(fiber)

      // Drain forked ensureTitle after the main loop finishes.
      yield* Effect.sleep(400)

      const final = yield* sessions.get(chat.id)
      expect(final.title).toBe("User renamed mid-gen")
      expect(hooks.setTitleCalls.filter((c) => c.title === "E2E Title")).toHaveLength(0)
      expect(consumeAutoTitle(chat.id, "E2E Title")).toBe(false)
    }),
  20_000,
)

it.instance(
  "ensureTitle clears auto-title mark when setTitle fails",
  () =>
    Effect.gen(function* () {
      resetHooks()
      const { llm } = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service

      const chat = yield* sessions.create({})
      expect(Session.isDefaultTitle(chat.title)).toBe(true)

      // Keep the prompt scope open (hold main LLM) until ensureTitle's setTitle runs;
      // the title fork is scoped to the prompt and is interrupted when it ends.
      hooks.failSetTitle = true
      const releaseMain = yield* Deferred.make<void>()
      yield* llm.hold("assistant reply", deferredAsPromise(releaseMain))

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "hello for title fail" }],
        })
        .pipe(Effect.forkChild)

      yield* pollWithTimeout(
        Effect.sync(() => (hooks.setTitleCalls.length > 0 ? true : undefined)),
        `ensureTitle never called setTitle; calls=${JSON.stringify(hooks.setTitleCalls)}`,
        "15 seconds",
      )
      yield* Effect.sleep(100)

      yield* Deferred.succeed(releaseMain, undefined).pipe(Effect.ignore)
      yield* Fiber.join(fiber)

      const final = yield* sessions.get(chat.id)
      expect(Session.isDefaultTitle(final.title)).toBe(true)
      expect(hooks.setTitleCalls.length).toBeGreaterThanOrEqual(1)
      // Production catch must have cleared the re-mark left inside the failing setTitle.
      for (const call of hooks.setTitleCalls) {
        expect(consumeAutoTitle(chat.id, call.title)).toBe(false)
      }
    }),
  30_000,
)

it.instance(
  "ensureTitle leaves a consumable auto-title mark after a successful write",
  () =>
    Effect.gen(function* () {
      resetHooks()
      const { llm } = yield* useServerConfig()
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service

      const chat = yield* sessions.create({})
      expect(Session.isDefaultTitle(chat.title)).toBe(true)
      consumeAutoTitle(chat.id, "E2E Title")

      // Hold main open until title setTitle runs (title fork is prompt-scoped).
      // Do not stall the title stream — let TestLLMServer auto-reply "E2E Title".
      const releaseMain = yield* Deferred.make<void>()
      yield* llm.hold("assistant reply", deferredAsPromise(releaseMain))

      const fiber = yield* prompt
        .prompt({
          sessionID: chat.id,
          agent: "build",
          model: ref,
          parts: [{ type: "text", text: "hello for title success" }],
        })
        .pipe(Effect.forkChild)

      // Poll session title (works even if setTitle wrapper is bypassed) and hooks.
      yield* pollWithTimeout(
        Effect.gen(function* () {
          const s = yield* sessions.get(chat.id).pipe(Effect.orElseSucceed(() => null))
          if (s?.title === "E2E Title") return true
          if (hooks.setTitleCalls.some((c) => c.title === "E2E Title")) return true
          return undefined
        }),
        `ensureTitle never applied E2E Title; calls=${JSON.stringify(hooks.setTitleCalls)}`,
        "20 seconds",
      )

      // Mark is process-global and testLayer has no Updated consumer — still consumable.
      expect(consumeAutoTitle(chat.id, "E2E Title")).toBe(true)
      expect(consumeAutoTitle(chat.id, "E2E Title")).toBe(false)

      const titled = yield* sessions.get(chat.id)
      expect(titled.title).toBe("E2E Title")

      yield* Deferred.succeed(releaseMain, undefined).pipe(Effect.ignore)
      yield* Fiber.join(fiber)
    }),
  40_000,
)
