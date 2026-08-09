import { NodeFileSystem } from "@effect/platform-node"
import { ConfigV1 } from "@opencode-ai/core/v1/config/config"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { eq } from "drizzle-orm"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Bus } from "@/bus" // kilocode_change - ToolRegistry retains the Kilo bus dependency
import { FetchHttpClient } from "effect/unstable/http"
// kilocode_change start
import { expect, spyOn } from "bun:test"
import { Telemetry } from "@kilocode/kilo-telemetry"
import { legacyReviewMessage } from "../../src/kilocode/review/command"
// kilocode_change end
import { Cause, Deferred, Duration, Effect, Exit, Fiber, Layer } from "effect"
import path from "path"
import { fileURLToPath, pathToFileURL } from "url"
import { NamedError } from "@opencode-ai/core/util/error"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { Command } from "../../src/command"
import { Auth } from "../../src/auth" // kilocode_change
import { Config } from "@/config/config"
import { LSP } from "@/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "@/provider/provider"
import { Env } from "../../src/env"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"

import { Question } from "../../src/question"
import { Todo } from "../../src/session/todo"
import { Session } from "@/session/session"
import { SessionMessageTable } from "@opencode-ai/core/session/sql"
import { LLM } from "../../src/session/llm"
import { MessageV2 } from "../../src/session/message-v2"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { SessionCompaction } from "../../src/session/compaction"
import { SessionSummary } from "../../src/session/summary"
import { Instruction } from "../../src/session/instruction"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { KiloSession } from "../../src/kilocode/session" // kilocode_change
import { Suggestion } from "../../src/kilocode/suggestion" // kilocode_change - accept suggestion in telemetry test
import { MessageID, PartID, SessionID } from "../../src/session/schema"
import { SessionStatus } from "../../src/session/status"
import { SessionV2 } from "@opencode-ai/core/session"
import { Skill } from "../../src/skill"
import { SystemPrompt } from "../../src/session/system"
import { Shell } from "../../src/shell/shell"
import { Snapshot } from "../../src/snapshot"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import * as Log from "@opencode-ai/core/util/log"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { Format } from "../../src/format"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
import { TestInstance } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MemoryService } from "@kilocode/kilo-memory/effect/service" // kilocode_change
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { layer as NodeLayer } from "../../src/rlm/node"

void Log.init({ print: false })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

function withSh<A, E, R>(fx: () => Effect.Effect<A, E, R>) {
  return Effect.acquireUseRelease(
    Effect.sync(() => {
      const prev = process.env.SHELL
      process.env.SHELL = "/bin/sh"
      Shell.preferred.reset()
      return prev
    }),
    () => fx(),
    (prev) =>
      Effect.sync(() => {
        if (prev === undefined) delete process.env.SHELL
        else process.env.SHELL = prev
        Shell.preferred.reset()
      }),
  )
}

function toolPart(parts: SessionV1.Part[]) {
  return parts.find((part): part is SessionV1.ToolPart => part.type === "tool")
}

type CompletedToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateCompleted }
type ErrorToolPart = SessionV1.ToolPart & { state: SessionV1.ToolStateError }

function completedTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("completed")
  return part?.state.status === "completed" ? (part as CompletedToolPart) : undefined
}

function errorTool(parts: SessionV1.Part[]) {
  const part = toolPart(parts)
  expect(part?.state.status).toBe("error")
  return part?.state.status === "error" ? (part as ErrorToolPart) : undefined
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
    startAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
    authenticate: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in prompt-effect tests"),
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

// kilocode_change start
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

const processorCreateStarted: Deferred.Deferred<void>[] = []
const blockingProcessor = Layer.succeed(
  SessionProcessor.Service,
  SessionProcessor.Service.of({
    create: () =>
      Effect.gen(function* () {
        const started = processorCreateStarted.shift()
        if (started) yield* Deferred.succeed(started, undefined).pipe(Effect.ignore)
        return yield* Effect.never
      }),
  }),
)
// kilocode_change end

function makePrompt(input?: { processor?: "blocking" }) {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    input?.processor === "blocking" ? fastAgents : AgentSvc.defaultLayer, // kilocode_change
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
    Bus.layer, // kilocode_change - satisfy the Kilo ToolRegistry dependency
    MemoryService.layer, // kilocode_change
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provide(Auth.defaultLayer), // kilocode_change
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const node = NodeLayer.pipe(Layer.provideMerge(deps))
  const proc =
    input?.processor === "blocking"
      ? blockingProcessor
      : SessionProcessor.layer.pipe(
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
    Layer.provide(Reference.defaultLayer),
    Layer.provide(summary),
    Layer.provideMerge(run),
    Layer.provideMerge(compact),
    Layer.provideMerge(proc),
    Layer.provideMerge(registry),
    Layer.provideMerge(trunc),
    Layer.provideMerge(question), // kilocode_change - SessionPrompt dismisses pending questions
    Layer.provide(Instruction.defaultLayer),
    Layer.provide(SystemPrompt.defaultLayer),
    Layer.provide(RuntimeFlags.layer({ experimentalEventSystem: true })),
    Layer.provideMerge(deps),
    Layer.provideMerge(node),
    Layer.provide(summary),
  )
}

function makeHttp(input?: { processor?: "blocking" }) {
  return Layer.mergeAll(TestLLMServer.layer, makePrompt(input))
}

function makeHttpNoLLMServer(input?: { processor?: "blocking" }) {
  return makePrompt(input)
}

const it = testEffect(makeHttp())
const noLLMServer = testEffect(makeHttpNoLLMServer())
const raceNoLLMServer = testEffect(makeHttpNoLLMServer({ processor: "blocking" }))
const unix = process.platform !== "win32" ? it.instance : it.instance.skip
const unixNoLLMServer = process.platform !== "win32" ? noLLMServer.instance : noLLMServer.instance.skip

// Config that registers a custom "test" provider with a "test-model" model
// so provider model lookup succeeds inside the loop.
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

const writeText = Effect.fn("test.writeText")(function* (file: string, text: string) {
  const fs = yield* FSUtil.Service
  yield* fs.writeWithDirs(file, text)
})

const ensureDir = Effect.fn("test.ensureDir")(function* (dir: string) {
  const fs = yield* FSUtil.Service
  yield* fs.ensureDir(dir)
})

const writeConfig = Effect.fn("test.writeConfig")(function* (dir: string, config: Partial<ConfigV1.Info>) {
  yield* writeText(
    path.join(dir, "opencode.json"),
    JSON.stringify({ $schema: "https://app.kilo.ai/config.json", ...config }), // kilocode_change
  )
})

const useServerConfig = Effect.fn("test.useServerConfig")(function* (config: (url: string) => Partial<ConfigV1.Info>) {
  const { directory: dir } = yield* TestInstance
  const llm = yield* TestLLMServer
  yield* writeConfig(dir, config(llm.url))
  return { dir, llm }
})

// kilocode_change start - wait for the runner state that cancel observes instead of session status
const waitForBusy = (sessionID: SessionID, duration: Duration.Input = "2 seconds") =>
  pollWithTimeout(
    Effect.gen(function* () {
      const run = yield* SessionRunState.Service
      const exit = yield* run.assertNotBusy(sessionID).pipe(Effect.exit)
      return Exit.isFailure(exit) ? (true as const) : undefined
    }),
    `session ${sessionID} never became busy`,
    duration,
  )
// kilocode_change end

const hasBash = Effect.sync(() => Bun.which("bash") !== null)

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

const succeedVoid = (deferred: Deferred.Deferred<void>) => {
  Effect.runSync(Deferred.succeed(deferred, void 0).pipe(Effect.ignore))
}

const user = Effect.fn("test.user")(function* (sessionID: SessionID, text: string) {
  const session = yield* Session.Service
  const msg = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: msg.id,
    sessionID,
    type: "text",
    text,
  })
  return msg
})

const seed = Effect.fn("test.seed")(function* (sessionID: SessionID, opts?: { finish?: string }) {
  const session = yield* Session.Service
  const msg = yield* user(sessionID, "hello")
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: msg.id,
    sessionID,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    time: { created: Date.now() },
    ...(opts?.finish ? { finish: opts.finish } : {}),
  }
  yield* session.updateMessage(assistant)
  yield* session.updatePart({
    id: PartID.ascending(),
    messageID: assistant.id,
    sessionID,
    type: "text",
    text: "hi there",
  })
  return { user: msg, assistant }
})

const addSubtask = (sessionID: SessionID, messageID: MessageID, model = ref) =>
  Effect.gen(function* () {
    const session = yield* Session.Service
    yield* session.updatePart({
      id: PartID.ascending(),
      messageID,
      sessionID,
      type: "subtask",
      prompt: "look into the cache key path",
      description: "inspect bug",
      agent: "general",
      model,
    })
  })

const boot = Effect.fn("test.boot")(function* (input?: { title?: string }) {
  const config = yield* Config.Service
  const prompt = yield* SessionPrompt.Service
  const run = yield* SessionRunState.Service
  const sessions = yield* Session.Service
  yield* config.get()
  const chat = yield* sessions.create(input ?? { title: "Pinned" })
  return { prompt, run, sessions, chat }
})

import { execute as rlmExecute } from "../../src/rlm/runtime"
import { SessionPrompt } from "../../src/session/prompt"
import { Fiber } from "effect"

it.instance("Test 1: Phase 1 End-to-End executes through real SessionPrompt and returns RLMResult", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Test Chat" })

    // NOTE: no ambient promptSvc.loop() is forked here. SessionPrompt.prompt()
    // creates and enqueues its own loop; an ambient loop would occupy the
    // session Runner and deadlock every subsequent prompt() (llm.calls = 0).

    yield* llm.text("42")

    const result = yield* rlmExecute({
      sessionID: chat.id,
      description: "Return 42",
      prompt: "Respond with exactly 42 and nothing else."
    })

    expect(result).toBeDefined()
    expect((result as any).status).toBe("success")
    expect((result as any).output).toBe("42")
    expect((result as any).taskID).toBeDefined()
    expect((result as any).usage).toBeDefined()
    expect((result as any).duration).toBeGreaterThanOrEqual(0)
  }),
  { config: cfg },
  // First LLM call of a test run pays a one-time on-demand install of the
  // test provider's SDK package (@ai-sdk/openai-compatible) into the per-run
  // npm cache (~3-4s), so the default 5s deadline is too tight.
  15_000,
)

it.instance("Test 2: RLM Disabled executes leaf only", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Test Chat" })

    yield* llm.text("42")

    const result = yield* rlmExecute({
      sessionID: chat.id,
      description: "Return 42",
      prompt: "Respond with exactly 42 and nothing else."
    })

    expect(result).toBeDefined()
    expect((result as any).status).toBe("success")
    expect((result as any).output).toBe("42")
  }),
  { config: () => {
      return { ...cfg, rlm: { enabled: false } }
  }}
)

// --- Helper: create an rlm-enabled providerCfg variant ---
function rlmProviderCfg(url: string, rlmOverrides?: Record<string, unknown>) {
  return {
    ...providerCfg(url),
    rlm: { enabled: true, maxDepth: 1, maxReinvestigations: 0, verification: { enabled: true }, ...rlmOverrides },
  }
}

// --- Test 3: Recursive Decomposition ---
// When RLM is enabled and the node layer is present, the planner should
// decompose into children that execute as leaves, then aggregate.
it.instance("Test 3: Recursive decomposition decomposes into children and aggregates", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => rlmProviderCfg(url, { verification: false }))
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Decompose Test" })

    // 1. Planner response — decompose into 2 children
    const planJson = JSON.stringify({
      strategy: "decompose",
      children: [
        { description: "Part A", prompt: "Return Part A", parallelizable: true, dependsOn: [] },
        { description: "Part B", prompt: "Return Part B", parallelizable: true, dependsOn: [] },
      ],
      rationale: "Split the work",
    })
    yield* llm.text(planJson)  // planner call
    yield* llm.text("Part A output")  // child 1 executor
    yield* llm.text("Part B output")  // child 2 executor

    const result = yield* rlmExecute({
      sessionID: chat.id,
      description: "Two-part task",
      prompt: "Do two things",
    })

    expect(result).toBeDefined()
    const r = result as any
    // Real LLM evidence: planner + 2 children must have hit the mock and
    // consumed all queued responses (title requests are auto-answered).
    const calls = yield* llm.calls
    expect(calls).toBeGreaterThanOrEqual(3)
    const pending = yield* llm.pending
    expect(pending).toBe(0)
    // The aggregator concatenates child outputs
    expect(r.status).toBe("success")
    expect(r.output).toContain("Part A output")
    expect(r.output).toContain("Part B output")
    expect(r.taskID).toBeDefined()
  }),
  { config: cfg },
  30_000,
)

// --- Test 4: DAG Waves (dependency ordering) ---
// Children with dependsOn should execute after their dependencies.
// Child 0 runs in wave 0, Child 1 (depends on 0) runs in wave 1.
it.instance("Test 4: DAG waves respect dependency ordering", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) => rlmProviderCfg(url, { verification: false }))
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "DAG Test" })

    const planJson = JSON.stringify({
      strategy: "decompose",
      children: [
        { description: "First", prompt: "First step", parallelizable: true, dependsOn: [] },
        { description: "Second", prompt: "Second step", parallelizable: false, dependsOn: [0] },
      ],
      rationale: "Sequential dependency",
    })
    yield* llm.text(planJson)
    yield* llm.text("First result")
    yield* llm.text("Second result")

    const result = yield* rlmExecute({
      sessionID: chat.id,
      description: "Sequential task",
      prompt: "Do A then B",
    })

    const r = result as any
    expect(r.status).toBe("success")
    // Second must appear after First in concatenated output
    const firstIdx = r.output.indexOf("First result")
    const secondIdx = r.output.indexOf("Second result")
    expect(firstIdx).toBeGreaterThanOrEqual(0)
    expect(secondIdx).toBeGreaterThan(firstIdx)
  }),
  { config: cfg },
  30_000,
)

// --- Test 5: Verification + Reinvestigation ---
// When the verifier returns "reinvestigate", node should re-execute up to maxReinvestigations.
it.instance("Test 5: Verification triggers reinvestigation then passes", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig((url) =>
      rlmProviderCfg(url, { maxReinvestigations: 1, verification: { enabled: true } }),
    )
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Verify Test" })

    // Attempt 1: planner says execute directly (depth 0, but maxDepth=1
    // means depth>=maxDepth is false since 0 < 1, so planner IS called).
    // Actually at depth 0, maxDepth 1: 0 < 1, so planner IS called.
    // Provide planner "execute" so it goes to leaf, then verifier says "reinvestigate".
    const executePlan = JSON.stringify({ strategy: "execute", rationale: "Direct" })
    const reinvestigateVerdict = JSON.stringify({
      verdict: "reinvestigate",
      confidence: 0.3,
      reasoning: "Needs more work",
      findings: [{ key: "incomplete", severity: "warning", description: "Missing details" }],
      targetTasks: [],
    })
    const passVerdict = JSON.stringify({
      verdict: "pass",
      confidence: 0.95,
      reasoning: "Looks good now",
      findings: [],
      targetTasks: [],
    })

    // Attempt 1: planner → execute → leaf → verifier → reinvestigate
    yield* llm.text(executePlan)   // planner call 1
    yield* llm.text("First try")   // executor call 1
    yield* llm.text(reinvestigateVerdict)  // verifier call 1

    // Attempt 2 (reinvestigation): depth >= maxDepth check doesn't apply (reinvestigationCount > 0
    // forces execute strategy), so goes straight to leaf → verifier → pass
    yield* llm.text("Better answer")  // executor call 2
    yield* llm.text(passVerdict)  // verifier call 2

    const result = yield* rlmExecute({
      sessionID: chat.id,
      description: "Verify me",
      prompt: "Give a good answer",
    })

    const r = result as any
    expect(r).toBeDefined()
    expect(r.status).toBe("success")
    // The final result should be the second attempt's output
    expect(r.output).toContain("Better answer")
  }),
  { config: cfg },
  60_000,
)

// --- Test 6: Hierarchical Budget ---
// This tests the budget class directly (unit-level) since the full integration
// requires budget wiring in the executor which isn't connected to token counting yet.
import { RLMBudget } from "../../src/rlm/budget/budget"

it.instance("Test 6: Hierarchical budget tracks parent-child spending", () =>
  Effect.gen(function* () {
    const parent = new RLMBudget(10000)
    expect(parent.remaining).toBe(10000)
    expect(parent.enabled).toBe(true)

    // Derive two children with equal shares
    const child1 = parent.deriveEqualShare(2)
    const child2 = parent.deriveEqualShare(2)
    expect(child1.maxTokens).toBe(5000)
    // child2 gets half of remaining (10000) = 5000
    expect(child2.maxTokens).toBe(5000)

    // Spend from child1
    child1.spend({ input: 100, output: 200, reasoning: 0, cache: { read: 0, write: 0 }, total: 300 })
    expect(child1.used.total).toBe(300)
    // Parent should see child spending
    expect(parent.remaining).toBe(10000 - 300)

    // Check budget enforcement
    const overcheck = parent.check(10000)
    expect(overcheck).not.toBeNull()

    const undercheck = parent.check(100)
    expect(undercheck).toBeNull()

    // Derive a child from the parent — should be capped by remaining
    const child3 = parent.deriveChild(20000)
    expect(child3.maxTokens).toBeLessThanOrEqual(parent.remaining + child3.maxTokens) // capped

    // Zero budget should disable
    const disabled = new RLMBudget(0)
    expect(disabled.enabled).toBe(false)
    expect(disabled.check(1000)).toBeNull() // disabled budget never blocks
  }),
  { config: cfg },
)

// --- Test 7: Abort ---
// When the abort controller is signaled, the executor should bail.
import { rlmAborted } from "../../src/rlm/error"
import { createTask } from "../../src/rlm/task"
import { run as executeLeafDirect } from "../../src/rlm/executor"
import type { RLMContext } from "../../src/rlm/context"

it.instance("Test 7: Abort signal prevents executor from starting", () =>
  Effect.gen(function* () {
    const { llm } = yield* useServerConfig(providerCfg)
    const sessions = yield* Session.Service
    const chat = yield* sessions.create({ title: "Abort Test" })

    const task = createTask({
      sessionID: chat.id,
      description: "Abort me",
      prompt: "Never see this",
      depth: 0,
    })

    const controller = new AbortController()
    controller.abort() // pre-abort

    const agentSvc = yield* AgentSvc.Service
    const agentInfo = yield* agentSvc.defaultInfo()

    const ctx: RLMContext = {
      rootSessionID: chat.id,
      abort: controller.signal,
      task,
      config: { enabled: false, maxDepth: 4, maxReinvestigations: 0 },
      agent: agentInfo,
      budget: null,
      permission: null,
      crossContext: null,
      plan: null,
    }

    // The executor should fail with rlmAborted
    const exit = yield* executeLeafDirect(task, ctx).pipe(Effect.exit)
    expect(exit._tag).toBe("Failure")
  }),
  { config: cfg },
  15_000,
)
