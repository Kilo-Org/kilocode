import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect } from "bun:test"
import { Cause, Deferred, Effect, Exit, Fiber, Layer, Scope } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { BackgroundJob } from "../../src/background/job"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Plugin } from "../../src/plugin"
import { Session } from "../../src/session/session"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionStatus } from "../../src/session/status"
import { SessionRunState } from "../../src/session/run-state"
import { SessionSummary } from "../../src/session/summary"
import { MessageID, SessionID } from "../../src/session/schema"
import { MessageV2 } from "../../src/session/message-v2"
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { BoardStore } from "../../src/kilocode/board/store"
import { KiloSessionControl } from "../../src/kilocode/session/control"
import { KiloSessionSteering } from "../../src/kilocode/session/steering"
import { KiloTaskPause } from "../../src/kilocode/tool/task-pause"
import { disposeAllInstancesEffect, provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const plugin = Layer.mock(Plugin.Service)({
  trigger: <Output>(_name: string, _input: unknown, output: Output) => Effect.succeed(output),
  list: () => Effect.succeed([]),
  init: () => Effect.void,
})

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    instructions: () => Effect.succeed([]),
    resourceTemplates: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in task pause test"),
    authenticate: () => Effect.die("unexpected MCP auth in task pause test"),
    finishAuth: () => Effect.die("unexpected MCP auth in task pause test"),
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

const memory = LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] })
const server = LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] })
const root = LayerNode.group([
  SessionPrompt.node,
  Session.node,
  SessionStatus.node,
  SessionRunState.node,
  Config.node,
  RuntimeFlags.node,
  SessionProjector.node,
  BackgroundJob.node,
  Database.node,
  CrossSpawnSpawner.node,
  memory,
  server,
])

const it = testEffect(
  LayerNode.compile(root, [
    [SessionSummary.node, summary],
    [Plugin.node, plugin],
    [LSP.node, lsp],
    [MCP.node, mcp],
    [KiloSessions.node, KiloSessions.testLayer],
  ]),
)

const model = (id: string) => ({
  id,
  name: id,
  attachment: false,
  reasoning: false,
  temperature: false,
  tool_call: true,
  release_date: "2025-01-01",
  limit: { context: 100000, output: 10000 },
  cost: { input: 0, output: 0 },
  options: {},
})

function config(url: string) {
  return {
    model: "test/parent-model",
    enabled_providers: ["test"],
    snapshot: false,
    subagent_depth: 2,
    shared_agent_board: true,
    permission: { "*": "allow" as const },
    agent: { general: { model: "test/child-model", permission: { task: "allow" as const } } },
    provider: {
      test: {
        name: "Test",
        id: "test",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        models: { "parent-model": model("parent-model"), "child-model": model("child-model") },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

type Body = Record<string, unknown>

function last(body: Body) {
  if (!Array.isArray(body.messages)) return ""
  const user = body.messages.findLast((message) => message.role === "user")
  return JSON.stringify(user?.content ?? "")
}

const parent = ({ body }: { body: Body }) => body.model === "parent-model"
const child =
  (text: string) =>
  ({ body }: { body: Body }) =>
    body.model === "child-model" && last(body).includes(text)

const task = (prompt: string, extra: Record<string, unknown> = {}) =>
  reply().tool("task", { description: "Inspect parser", prompt, subagent_type: "general", ...extra })

const services = Effect.gen(function* () {
  return {
    prompt: yield* SessionPrompt.Service,
    sessions: yield* Session.Service,
    status: yield* SessionStatus.Service,
    jobs: yield* BackgroundJob.Service,
    llm: yield* TestLLMServer,
  }
})

/** Start a parent turn and return once the first subagent is busy on its model call. */
const launch = Effect.fn("TaskPauseTest.launch")(function* (text = "PARENT_REQUEST") {
  const svc = yield* services
  const chat = yield* svc.sessions.create({ title: "Pause parent" })
  const fiber = yield* svc.prompt
    .prompt({ sessionID: chat.id, agent: "code", parts: [{ type: "text", text }] })
    .pipe(Effect.forkScoped)
  const id = yield* pollWithTimeout(
    Effect.gen(function* () {
      const found = (yield* svc.sessions.children(chat.id))[0]?.id
      if (!found) return undefined
      if ((yield* svc.status.get(found)).type !== "busy") return undefined
      const hits = yield* svc.llm.hits
      return hits.some((hit) => hit.body.model === "child-model") ? found : undefined
    }),
    "subagent never started",
    "15 seconds",
  )
  return { ...svc, chat, fiber, child: id }
})

const paused = (id: SessionID) =>
  pollWithTimeout(
    Effect.sync(() => (KiloTaskPause.paused(id) ? true : undefined)),
    "task never paused",
    "10 seconds",
  )

/** Wait for `count` pause notices on the parent's board; the notice posts just after the pause registers. */
const notices = (parent: SessionID, count: number) =>
  pollWithTimeout(
    BoardStore.read({ sessionID: parent }).pipe(
      Effect.map((board) => {
        const list = board.messages.filter((item) => item.body === KiloTaskPause.NOTICE)
        return list.length >= count ? board.messages : undefined
      }),
    ),
    "the pause notice was not posted",
    "10 seconds",
  )

const settled = Effect.fn("TaskPauseTest.settled")(function* () {
  const jobs = yield* BackgroundJob.Service
  return yield* pollWithTimeout(
    jobs.list().pipe(Effect.map((list) => (list.every((job) => job.status !== "running") ? list : undefined))),
    "a task job is still running",
    "10 seconds",
  )
})

const taskPart = Effect.fn("TaskPauseTest.taskPart")(function* (id: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.messages({ sessionID: id }))
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "task")
})

/** A human steering prompt in the subagent view, the way the TUI sends it. */
const steer = (id: SessionID, text: string) =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    return yield* prompt.prompt({
      sessionID: id,
      agent: "general",
      parts: [{ type: "text", text, metadata: { kind: KiloSessionSteering.KIND } }],
    })
  })

/** The finalized assistant message of a turn the user interrupted. */
function aborted(sessionID: SessionID) {
  const message: MessageV2.Assistant = {
    id: MessageID.ascending(),
    sessionID,
    role: "assistant",
    parentID: MessageID.ascending(),
    modelID: ModelV2.ID.make("child-model"),
    providerID: ProviderV2.ID.make("test"),
    mode: "general",
    agent: "general",
    path: { cwd: "/", root: "/" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: 1, completed: 2 },
    error: new MessageV2.AbortedError({ message: "aborted" }).toObject(),
  }
  return { info: message, parts: [] }
}

const injected = (id: SessionID, text: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return yield* pollWithTimeout(
      sessions
        .messages({ sessionID: id })
        .pipe(
          Effect.map((messages) =>
            messages.some(
              (message) => KiloSessionControl.background(message.parts) && JSON.stringify(message.parts).includes(text),
            )
              ? messages
              : undefined,
          ),
        ),
      `background result "${text}" was not delivered`,
      "10 seconds",
    )
  })

it.live(
  "a subagent-view interrupt pauses a foreground task until a prompt resumes it",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()

        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        // the parent is still blocked in its task call and the job is alive
        expect((yield* run.status.get(run.chat.id)).type).toBe("busy")
        expect((yield* run.jobs.get(run.child))?.status).toBe("running")
        const part = yield* taskPart(run.chat.id)
        expect(part?.type === "tool" && part.state.status).toBe("running")
        expect((yield* run.status.get(run.child)).type).toBe("idle")
        expect(yield* run.prompt.paused(run.child)).toBe(true)
        expect((yield* run.sessions.get(run.child)).metadata?.[KiloTaskPause.KEY]).toEqual({ status: "paused" })
        // foreground pauses never post to the board
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])

        // interrupting the idle, paused subagent again does not end the task
        yield* run.prompt.cancel(run.child, "session")
        expect(KiloTaskPause.paused(run.child)).toBe(true)
        expect((yield* run.jobs.get(run.child))?.status).toBe("running")
        expect((yield* run.status.get(run.chat.id)).type).toBe("busy")

        // a steering prompt resumes the task, which completes with that turn's result
        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("resumed result").stop())
        yield* run.llm.pushMatch(parent, reply().text("parent done").stop())
        yield* steer(run.child, "STEER_ON")
        const result = yield* awaitWithTimeout(Fiber.join(run.fiber), "parent stayed blocked", "15 seconds")
        expect(result.parts.some((part) => part.type === "text" && part.text === "parent done")).toBe(true)
        const first = yield* taskPart(run.chat.id)
        if (first?.type !== "tool" || first.state.status !== "completed") throw new Error("task did not complete")
        expect(first.state.output).toContain('state="completed"')
        expect(first.state.output).toContain("resumed result")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        expect((yield* run.sessions.get(run.child)).metadata?.[KiloTaskPause.KEY]).toBeUndefined()
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a background grandchild keeps running through the pause and is stored without a child turn",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        const done = Promise.withResolvers<void>()
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), task("GRAND_WORK", { background: true }), reply().hang())
        yield* svc.llm.pushMatch(child("GRAND_WORK"), reply().wait(done.promise).text("GRAND_RESULT").stop())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())

        const run = yield* launch()
        const grand = yield* pollWithTimeout(
          Effect.gen(function* () {
            const found = (yield* run.sessions.children(run.child))[0]?.id
            if (!found) return undefined
            return (yield* run.status.get(found)).type === "busy" ? found : undefined
          }),
          "grandchild never started",
          "10 seconds",
        )
        yield* pollWithTimeout(
          run.llm.pending.pipe(Effect.map((count) => (count <= 1 ? true : undefined))),
          "child never reached its hanging step",
          "10 seconds",
        )

        yield* run.prompt.cancel(run.child, "session")
        // the pause does not wait on the grandchild's drain hold
        yield* paused(run.child)
        expect((yield* run.jobs.get(grand))?.status).toBe("running")
        expect((yield* run.status.get(grand)).type).toBe("busy")

        const calls = yield* run.llm.calls

        // the grandchild's result is stored in the paused child without starting a child turn
        done.resolve()
        yield* injected(run.child, "GRAND_RESULT")
        expect((yield* run.jobs.get(grand))?.status).toBe("completed")
        expect((yield* run.status.get(run.child)).type).toBe("idle")
        expect(yield* run.llm.calls).toBe(calls)
        expect(KiloTaskPause.paused(run.child)).toBe(true)

        // the resumed turn sees the stored result and completes the task
        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("child result").stop())
        yield* steer(run.child, "STEER_ON")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent stayed blocked", "15 seconds")
        const hit = (yield* run.llm.hits).find((item) => child("STEER_ON")(item))
        expect(JSON.stringify(hit?.body)).toContain("GRAND_RESULT")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a subagent-view interrupt cancels a foreground grandchild",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), task("GRAND_WORK"))
        yield* svc.llm.pushMatch(child("GRAND_WORK"), reply().hang())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())
        const run = yield* launch()
        const grand = yield* pollWithTimeout(
          Effect.gen(function* () {
            const found = (yield* run.sessions.children(run.child))[0]?.id
            if (!found) return undefined
            const hits = yield* run.llm.hits
            return hits.some((hit) => child("GRAND_WORK")(hit)) ? found : undefined
          }),
          "grandchild never started",
          "10 seconds",
        )

        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        expect((yield* run.jobs.get(grand))?.status).toBe("cancelled")
        expect((yield* run.status.get(grand)).type).toBe("idle")
        expect((yield* run.jobs.get(run.child))?.status).toBe("running")

        // a tree cancel is the only way to end the paused task early
        yield* run.prompt.cancel(run.child, "tree")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent stayed blocked", "15 seconds")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a background task interrupt posts a board notice and injects only after a prompt resumes it",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")

        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        expect(yield* notices(run.chat.id, 1)).toEqual([
          expect.objectContaining({ from: run.child, to: "main", type: "INFO", body: KiloTaskPause.NOTICE }),
        ])
        const messages = yield* run.sessions.messages({ sessionID: run.chat.id })
        expect(messages.some((message) => KiloSessionControl.background(message.parts))).toBe(false)
        expect((yield* run.jobs.get(run.child))?.status).toBe("running")

        yield* run.prompt.cancel(run.child, "session")
        expect(KiloTaskPause.paused(run.child)).toBe(true)

        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("child result").stop())
        yield* run.llm.pushMatch(parent, reply().text("noted").stop())
        yield* steer(run.child, "STEER_ON")
        const delivered = yield* injected(run.chat.id, "Background task completed")
        expect(JSON.stringify(delivered)).toContain("child result")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "promoting a paused foreground task lets the parent continue and posts the notice",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"), reply().text("moved on").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()

        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])

        // Ctrl+B in the parent view promotes the running foreground task
        expect((yield* run.jobs.promote(run.child))?.metadata?.background).toBe(true)
        const result = yield* awaitWithTimeout(Fiber.join(run.fiber), "parent stayed blocked", "15 seconds")
        expect(result.parts.some((part) => part.type === "text" && part.text === "moved on")).toBe(true)
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "completed") throw new Error("task did not complete")
        expect(part.state.output).toContain("Background task started")
        yield* pollWithTimeout(
          BoardStore.read({ sessionID: run.chat.id }).pipe(
            Effect.map((board) =>
              board.messages.some((item) => item.from === run.child && item.body === KiloTaskPause.NOTICE)
                ? true
                : undefined,
            ),
          ),
          "promotion did not post the notice",
        )
        expect(KiloTaskPause.paused(run.child)).toBe(true)

        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("child result").stop())
        yield* run.llm.pushMatch(parent, reply().text("noted").stop())
        yield* steer(run.child, "STEER_ON")
        yield* injected(run.chat.id, "child result")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a parent task_id on a paused background task resumes it without deadlock",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* run.llm.pushMatch(parent, task("FOLLOW_UP", { task_id: run.child }), reply().text("sent").stop())
        yield* run.llm.pushMatch(child("FOLLOW_UP"), reply().text("follow-up result").stop())
        yield* run.llm.pushMatch(parent, reply().text("got it").stop())
        const turn = yield* awaitWithTimeout(
          run.prompt.prompt({ sessionID: run.chat.id, parts: [{ type: "text", text: "nudge the worker" }] }),
          "task_id on a paused task deadlocked",
          "15 seconds",
        )
        expect(turn.parts.some((part) => part.type === "text" && part.text === "sent")).toBe(true)
        const parts = (yield* run.sessions.messages({ sessionID: run.chat.id }))
          .flatMap((message) => message.parts)
          .filter((part) => part.type === "tool" && part.tool === "task")
        const update = parts.at(-1)
        if (update?.type !== "tool" || update.state.status !== "completed") throw new Error("task_id call failed")
        expect(update.state.output).toContain("Additional context sent to the running background task")

        yield* injected(run.chat.id, "follow-up result")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        expect((yield* run.jobs.get(run.child))?.status).toBe("completed")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a grandchild interrupted during a task_id-resumed turn pauses its own task",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        // the parent's task_id resumes the child, whose new turn starts a foreground grandchild
        yield* run.llm.pushMatch(parent, task("FOLLOW_UP", { task_id: run.child }), reply().text("sent").stop())
        yield* run.llm.pushMatch(child("FOLLOW_UP"), task("GRAND_WORK"), reply().text("child final").stop())
        yield* run.llm.pushMatch(child("GRAND_WORK"), reply().hang())
        yield* run.llm.pushMatch(parent, reply().text("got it").stop())
        yield* run.prompt.prompt({ sessionID: run.chat.id, parts: [{ type: "text", text: "nudge the worker" }] })
        const grand = yield* pollWithTimeout(
          Effect.gen(function* () {
            const found = (yield* run.sessions.children(run.child))[0]?.id
            if (!found) return undefined
            const hits = yield* run.llm.hits
            return hits.some((hit) => child("GRAND_WORK")(hit)) ? found : undefined
          }),
          "grandchild never started",
          "10 seconds",
        )

        // interrupting the grandchild pauses its task; the resumed child keeps waiting on it
        yield* run.prompt.cancel(grand, "session")
        yield* paused(grand)
        expect((yield* run.jobs.get(grand))?.status).toBe("running")
        expect((yield* run.status.get(run.child)).type).toBe("busy")

        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("grand result").stop())
        yield* steer(grand, "STEER_ON")
        yield* injected(run.chat.id, "child final")
        expect((yield* run.jobs.get(grand))?.status).toBe("completed")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a task_id between the interrupt and the pause reaches the child instead of queueing",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const jobs = yield* BackgroundJob.Service
        const id = SessionID.descending()
        // the task's run is still settling: its job runs, the child is stopped, no pause is registered yet
        yield* jobs.start({ id, type: "task", metadata: {}, run: Effect.never })
        const sent = yield* Deferred.make<void>()
        const queued = yield* Deferred.make<void>()
        const extended = yield* KiloTaskPause.extend(
          {
            jobs,
            direct: Deferred.succeed(sent, undefined),
            paused: () => Effect.succeed(true),
            scope: yield* Scope.Scope,
          },
          { id, run: Deferred.succeed(queued, undefined).pipe(Effect.as("")) },
        )
        expect(extended).toBe(true)
        yield* awaitWithTimeout(Deferred.await(sent), "the prompt queued behind the paused run", "5 seconds")
        expect(yield* Deferred.isDone(queued)).toBe(false)
        yield* jobs.cancel(id)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a task_id whose prompt fails before admission reports the failure",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const jobs = yield* BackgroundJob.Service
        const id = SessionID.descending()
        yield* jobs.start({ id, type: "task", metadata: {}, run: Effect.never })
        const exit = yield* KiloTaskPause.extend(
          {
            jobs,
            direct: Effect.fail(new Error("no such prompt")),
            paused: () => Effect.succeed(true),
            scope: yield* Scope.Scope,
          },
          { id, run: Effect.succeed("") },
        ).pipe(Effect.exit)
        expect(Exit.isFailure(exit)).toBe(true)
        expect(String(Exit.isFailure(exit) ? Cause.squash(exit.cause) : "")).toContain("no such prompt")
        yield* jobs.cancel(id)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a prompt admitted while the task is entering its pause resumes it",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        const id = SessionID.descending()
        yield* svc.jobs.start({ id, type: "task", metadata: {}, run: Effect.never })
        // the check sees the user stop; by the time the pause registers, a prompt has cleared it
        const checks = { count: 0 }
        const initial = aborted(id)
        const result = yield* awaitWithTimeout(
          KiloTaskPause.settle({
            child: id,
            parent: SessionID.descending(),
            initial,
            drain: { wait: () => Effect.void },
            sessions: { messages: () => Effect.succeed([]), touch: () => Effect.void },
            jobs: svc.jobs,
            paused: () => Effect.sync(() => checks.count++ === 0),
            board: {
              config: yield* Config.Service,
              flags: yield* RuntimeFlags.Service,
              database: yield* Database.Service,
            },
          }),
          "the task stayed paused after the prompt was admitted",
          "5 seconds",
        )
        expect(result).toBe(initial)
        expect(KiloTaskPause.paused(id)).toBe(false)
        yield* svc.jobs.cancel(id)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "parent Esc cancels a paused foreground task",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* run.prompt.cancel(run.chat.id, "session")
        yield* awaitWithTimeout(Fiber.await(run.fiber), "parent did not stop", "15 seconds")
        // same outcome as a parent Esc on a running foreground child: the parent's own turn is
        // interrupted, so its task call ends as an aborted tool and the child job is cancelled
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "error") throw new Error("task was not cancelled")
        expect(part.state.error).toBe("Tool execution aborted")
        expect((yield* run.jobs.get(run.child))?.status).toBe("cancelled")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

// TUI and VS Code cancel: a tree abort of the subagent (VS Code's task-card Stop)
it.live(
  "a tree cancel of a running subagent leaves the parent running and reports the task as cancelled",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"), reply().text("parent recovered").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()

        yield* run.prompt.cancel(run.child, "tree")
        const result = yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not continue", "15 seconds")
        // the parent was not aborted: it finished its step and made its next model call
        expect(result.parts.some((part) => part.type === "text" && part.text === "parent recovered")).toBe(true)
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "error") throw new Error("task was not cancelled")
        expect(part.state.error).toBe("Task cancelled by the user")
        // the reason reaches the parent model, so it does not treat the stop as a failure to retry
        const hit = (yield* run.llm.hits).findLast((item) => parent(item))
        expect(JSON.stringify(hit?.body)).toContain("Task cancelled by the user")
        expect((yield* run.status.get(run.child)).type).toBe("idle")
        expect((yield* run.jobs.get(run.child))?.status).toBe("cancelled")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a tree cancel of a paused subagent cancels its task",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"), reply().text("parent recovered").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* run.prompt.cancel(run.child, "tree")
        const result = yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not continue", "15 seconds")
        expect(result.parts.some((part) => part.type === "text" && part.text === "parent recovered")).toBe(true)
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "error") throw new Error("task was not cancelled")
        expect(part.state.error).toBe("Task cancelled by the user")
        expect((yield* run.jobs.get(run.child))?.status).toBe("cancelled")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "deleting a paused subagent cancels its task",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* run.sessions.remove(run.child)
        yield* pollWithTimeout(
          Effect.sync(() => (KiloTaskPause.paused(run.child) ? undefined : true)),
          "pause survived the delete",
        )
        expect((yield* run.jobs.get(run.child))?.status).toBe("cancelled")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "disposing the instance tears down a paused task",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        // provideTmpdirServer runs this body inside its own InstanceStore; its type does not say so
        yield* disposeAllInstancesEffect as Effect.Effect<void>
        yield* awaitWithTimeout(Fiber.await(run.fiber), "parent survived the dispose", "15 seconds")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a provider abort without a user stop fails the task instead of pausing it",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"), reply().text("parent recovered").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        // a runner cancel that does not go through SessionPrompt.cancel leaves the child unpaused
        const runState = yield* SessionRunState.Service
        yield* runState.cancel(run.child, { background: false })
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not continue", "15 seconds")
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "error") throw new Error("task did not fail")
        expect(part.state.error).toContain(`task_id="${run.child}"`)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a resumed task pauses again when its next turn is interrupted",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* run.llm.pushMatch(parent, task("FOLLOW_UP", { task_id: run.child }), reply().text("sent").stop())
        yield* run.llm.pushMatch(child("FOLLOW_UP"), reply().hang())
        yield* run.prompt.prompt({ sessionID: run.chat.id, parts: [{ type: "text", text: "nudge the worker" }] })
        yield* pollWithTimeout(
          Effect.gen(function* () {
            if (KiloTaskPause.paused(run.child)) return undefined
            return (yield* run.status.get(run.child)).type === "busy" ? true : undefined
          }),
          "the follow-up turn never started",
        )

        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        expect((yield* run.jobs.get(run.child))?.status).toBe("running")
        const posted = yield* notices(run.chat.id, 2)
        expect(posted.filter((item) => item.body === KiloTaskPause.NOTICE)).toHaveLength(2)

        yield* run.llm.pushMatch(child("STEER_ON"), reply().text("child result").stop())
        yield* run.llm.pushMatch(parent, reply().text("noted").stop())
        yield* steer(run.child, "STEER_ON")
        yield* injected(run.chat.id, "child result")
        yield* settled()
      }),
      { config },
    ),
  30_000,
)
