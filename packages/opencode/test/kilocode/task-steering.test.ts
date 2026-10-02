import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { expect } from "bun:test"
import { Effect, Fiber, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
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
import { KiloSessions } from "../../src/kilo-sessions/kilo-sessions"
import { BoardStore } from "../../src/kilocode/board/store"
import { KiloSessionControl } from "../../src/kilocode/session/control"
import { KiloTaskPause } from "../../src/kilocode/tool/task-pause"
import { KiloSessionSteering } from "../../src/kilocode/session/steering"
import { disposeAllInstancesEffect, provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { httpError, reply, TestLLMServer } from "../lib/llm-server"

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
    startAuth: () => Effect.die("unexpected MCP auth in task steering test"),
    authenticate: () => Effect.die("unexpected MCP auth in task steering test"),
    finishAuth: () => Effect.die("unexpected MCP auth in task steering test"),
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
const launch = Effect.fn("TaskSteeringTest.launch")(function* (text = "PARENT_REQUEST") {
  const svc = yield* services
  const chat = yield* svc.sessions.create({ title: "Steering parent" })
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

const settled = Effect.fn("TaskSteeringTest.settled")(function* () {
  const jobs = yield* BackgroundJob.Service
  return yield* pollWithTimeout(
    jobs.list().pipe(Effect.map((list) => (list.every((job) => job.status !== "running") ? list : undefined))),
    "a task job is still running",
    "10 seconds",
  )
})

const taskPart = Effect.fn("TaskSteeringTest.taskPart")(function* (id: SessionID) {
  const sessions = yield* Session.Service
  return (yield* sessions.messages({ sessionID: id }))
    .flatMap((message) => message.parts)
    .find((part) => part.type === "tool" && part.tool === "task")
})

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

const steer = (text: string) => ({ type: "text" as const, text, metadata: { kind: KiloSessionSteering.KIND } })

/** What the TUI sends when the user types into a subagent view: the child's agent and model, marked. */
const direct = (id: SessionID, text: string) =>
  Effect.gen(function* () {
    const prompt = yield* SessionPrompt.Service
    return yield* prompt.prompt({
      sessionID: id,
      agent: "general",
      model: { providerID: ProviderV2.ID.make("test"), modelID: ModelV2.ID.make("child-model") },
      parts: [steer(text)],
    })
  })

const block = (text: string) => `<user_steering>\n${text}\n</user_steering>`

/** The completed output of the parent's first task call. */
const output = Effect.fn("TaskSteeringTest.output")(function* (id: SessionID) {
  const part = yield* taskPart(id)
  if (part?.type !== "tool" || part.state.status !== "completed") throw new Error("task did not complete")
  return part.state.output
})

/** The child model request whose latest user message carries `text`. */
const request = Effect.fn("TaskSteeringTest.request")(function* (text: string) {
  const llm = yield* TestLLMServer
  const found = (yield* llm.hits).find((hit) => child(text)(hit))
  if (!found) throw new Error(`no child request for ${text}`)
  return JSON.stringify(found.body)
})

/** The steered turn is running: the pause has ended and the child is busy again. */
const resumed = (id: SessionID) =>
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    return yield* pollWithTimeout(
      Effect.gen(function* () {
        if (KiloTaskPause.paused(id)) return undefined
        return (yield* status.get(id)).type === "busy" ? true : undefined
      }),
      "the steered turn never started",
      "10 seconds",
    )
  })

const deliveries = (id: SessionID, text: string) =>
  Effect.gen(function* () {
    const sessions = yield* Session.Service
    return (yield* sessions.messages({ sessionID: id })).filter(
      (message) => KiloSessionControl.background(message.parts) && JSON.stringify(message.parts).includes(text),
    ).length
  })

it.live(
  "steering a paused foreground subagent returns the steered result through the original task call",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        yield* svc.llm.pushMatch(child("STEER_LEXER"), reply().text("lexer report").stop())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* direct(run.child, "STEER_LEXER")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "the original task call never returned", "15 seconds")
        const text = yield* output(run.chat.id)
        expect(text).toContain('state="completed"')
        expect(text).toContain(`${KiloSessionSteering.REDIRECTED}\n\n${block("STEER_LEXER")}\n\nlexer report`)
        // the steered child turn was told it was interrupted and that its answer goes to the parent
        const body = yield* request("STEER_LEXER")
        expect(body).toContain("The user interrupted you before you finished")
        // the reminder points at the steer instead of repeating it
        expect(body.split("STEER_LEXER")).toHaveLength(2)
        // the reminder is hidden from the user
        const users = (yield* run.sessions.messages({ sessionID: run.child })).filter(
          (message) => message.info.role === "user",
        )
        const reminder = users.at(-1)?.parts.find((part) => part.type === "text" && part.synthetic)
        expect(reminder?.type === "text" && reminder.text.startsWith("<system-reminder>")).toBe(true)
        // a foreground parent reads everything from the tool result
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])
        expect(KiloTaskPause.paused(run.child)).toBe(false)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "interrupt, steer, interrupt, steer loops and keeps both steers in order",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        yield* svc.llm.pushMatch(child("STEER_ONE"), reply().hang())
        yield* svc.llm.pushMatch(child("STEER_TWO"), reply().text("second answer").stop())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* direct(run.child, "STEER_ONE").pipe(Effect.forkScoped)
        yield* resumed(run.child)
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        expect((yield* run.status.get(run.chat.id)).type).toBe("busy")

        yield* direct(run.child, "STEER_TWO")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "the original task call never returned", "15 seconds")
        const text = yield* output(run.chat.id)
        expect(text).toContain(
          `${KiloSessionSteering.REDIRECTED}\n\n${block("STEER_ONE")}\n\n${block("STEER_TWO")}\n\nsecond answer`,
        )
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "steering a paused background subagent posts a notice and delivers one result",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK", { background: true }), reply().text("launched").stop())
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        yield* svc.llm.pushMatch(child("STEER_LEXER"), reply().text("lexer report").stop())
        const run = yield* launch()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "parent did not finish its launch turn", "15 seconds")
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)
        const notice = (yield* BoardStore.read({ sessionID: run.chat.id })).messages
        expect(notice).toEqual([expect.objectContaining({ from: run.child, type: "INFO", body: KiloTaskPause.NOTICE })])

        yield* run.llm.pushMatch(parent, reply().text("noted").stop())
        yield* direct(run.child, "STEER_LEXER")
        const board = (yield* BoardStore.read({ sessionID: run.chat.id })).messages
        expect(board).toHaveLength(2)
        expect(board.at(1)).toEqual(
          expect.objectContaining({ from: run.child, type: "INFO", body: expect.stringContaining("STEER_LEXER") }),
        )

        const delivered = JSON.stringify(yield* injected(run.chat.id, "lexer report"))
        expect(delivered).toContain("Background task completed")
        expect(delivered).toContain(
          JSON.stringify(`${KiloSessionSteering.REDIRECTED}\n\n${block("STEER_LEXER")}`).slice(1, -1),
        )
        yield* settled()
        expect(yield* deliveries(run.chat.id, "lexer report")).toBe(1)
        expect(yield* deliveries(run.chat.id, "Background task")).toBe(1)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "steering a running subagent that is not paused carries the steer in the result",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        const gate = Promise.withResolvers<void>()
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().wait(gate.promise).text("first answer").stop())
        yield* svc.llm.pushMatch(child("STEER_LEXER"), reply().text("steered answer").stop())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())
        const run = yield* launch()

        yield* direct(run.child, "STEER_LEXER").pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          run.sessions
            .messages({ sessionID: run.child })
            .pipe(
              Effect.map((messages) =>
                messages.some((message) => KiloSessionSteering.text(message.parts) === "STEER_LEXER")
                  ? true
                  : undefined,
              ),
            ),
          "the steer was never admitted",
          "10 seconds",
        )
        gate.resolve()
        yield* awaitWithTimeout(Fiber.join(run.fiber), "the original task call never returned", "15 seconds")
        const text = yield* output(run.chat.id)
        expect(text).toContain(`${block("STEER_LEXER")}\n\nsteered answer`)
        expect(text).not.toContain(KiloSessionSteering.REDIRECTED)
        expect(text).not.toContain(KiloSessionSteering.INTERRUPTED)
        const body = yield* request("STEER_LEXER")
        expect(body).toContain("then continue your original task")
        expect(body).toContain("not just an acknowledgement")
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a parent task_id on a paused background task resumes it and delivers the result once",
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
        yield* awaitWithTimeout(
          run.prompt.prompt({ sessionID: run.chat.id, parts: [{ type: "text", text: "nudge the worker" }] }),
          "task_id on a paused task deadlocked",
          "15 seconds",
        )
        const delivered = JSON.stringify(yield* injected(run.chat.id, "follow-up result"))
        // the parent's own follow-up is not a user steer
        expect(delivered).toContain(KiloSessionSteering.INTERRUPTED)
        expect(delivered).not.toContain("user_steering")
        yield* settled()
        expect(yield* deliveries(run.chat.id, "Background task")).toBe(1)
        expect(KiloTaskPause.paused(run.child)).toBe(false)
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a steered paused subagent sees its finished background grandchild's result",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        const done = Promise.withResolvers<void>()
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), task("GRAND_WORK", { background: true }), reply().hang())
        yield* svc.llm.pushMatch(child("GRAND_WORK"), reply().wait(done.promise).text("GRAND_RESULT").stop())
        const run = yield* launch()
        yield* pollWithTimeout(
          run.llm.pending.pipe(Effect.map((count) => (count === 0 ? true : undefined))),
          "child never reached its hanging step",
          "10 seconds",
        )
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        done.resolve()
        yield* injected(run.child, "GRAND_RESULT")
        expect(KiloTaskPause.paused(run.child)).toBe(true)

        yield* run.llm.pushMatch(child("STEER_USE"), reply().text("used the grandchild").stop())
        yield* run.llm.pushMatch(parent, reply().text("parent done").stop())
        yield* direct(run.child, "STEER_USE")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "the original task call never returned", "15 seconds")
        expect(yield* request("STEER_USE")).toContain("GRAND_RESULT")
        expect(yield* output(run.chat.id)).toContain(`${block("STEER_USE")}\n\nused the grandchild`)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a steer after the task delivered its result gets no reminder and never reaches the parent",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().text("done work").stop())
        yield* svc.llm.pushMatch(parent, reply().text("parent done").stop())
        const chat = yield* svc.sessions.create({ title: "Steering parent" })
        yield* awaitWithTimeout(
          svc.prompt.prompt({ sessionID: chat.id, agent: "code", parts: [{ type: "text", text: "PARENT_REQUEST" }] }),
          "the task call never returned",
          "15 seconds",
        )
        const found = (yield* svc.sessions.children(chat.id)).at(0)
        if (!found) throw new Error("the task never created a child")
        const run = { ...svc, chat, child: found.id }
        expect(yield* output(run.chat.id)).toContain("done work")
        expect(KiloSessionSteering.open(run.child)).toBe(false)

        yield* run.llm.pushMatch(child("STEER_AFTER"), reply().text("ack").stop())
        yield* direct(run.child, "STEER_AFTER")
        const users = (yield* run.sessions.messages({ sessionID: run.child })).filter(
          (message) => message.info.role === "user",
        )
        expect(users.at(-1)?.parts.some((part) => part.type === "text" && part.synthetic)).toBe(false)
        expect((yield* BoardStore.read({ sessionID: run.chat.id })).messages).toEqual([])
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live(
  "a steered subagent that then errors keeps the steering in the error result",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* () {
        const svc = yield* services
        yield* svc.llm.pushMatch(parent, task("CHILD_WORK"))
        yield* svc.llm.pushMatch(child("CHILD_WORK"), reply().hang())
        yield* svc.llm.pushMatch(
          child("STEER_BREAK"),
          httpError(400, { error: { message: "provider rejected the steer" } }),
        )
        yield* svc.llm.pushMatch(parent, reply().text("parent recovered").stop())
        const run = yield* launch()
        yield* run.prompt.cancel(run.child, "session")
        yield* paused(run.child)

        yield* direct(run.child, "STEER_BREAK")
        yield* awaitWithTimeout(Fiber.join(run.fiber), "the original task call never returned", "15 seconds")
        const part = yield* taskPart(run.chat.id)
        if (part?.type !== "tool" || part.state.status !== "error")
          throw new Error(`task did not fail: ${JSON.stringify(part)}`)
        expect(part.state.error).toContain(`${KiloSessionSteering.REDIRECTED}\n\n${block("STEER_BREAK")}`)
        expect(part.state.error).toContain("provider rejected the steer")
        expect(part.state.error).toContain(`task_id="${run.child}"`)
        yield* settled()
      }),
      { config },
    ),
  30_000,
)

it.live("a prompt admitted while the task is entering its pause still resumes it", () =>
  Effect.gen(function* () {
    const child = SessionID.make("ses_pause_race")
    // the child's turn was stopped by the user
    const stopped = {
      info: { id: MessageID.ascending(), role: "assistant", error: { name: "MessageAbortedError" } },
      parts: [],
    } as unknown as Parameters<typeof KiloTaskPause.settle>[0]["initial"]
    let checks = 0
    const settle = KiloTaskPause.settle({
      child,
      parent: SessionID.make("ses_pause_race_parent"),
      initial: stopped,
      drain: { wait: () => Effect.void },
      sessions: { messages: () => Effect.succeed([stopped]), touch: () => Effect.void },
      jobs: { get: () => Effect.succeed({ status: "running", metadata: {} } as never) },
      // the first check still sees the stop; a prompt is admitted (and resumes) before the pause registers
      paused: () =>
        Effect.gen(function* () {
          checks++
          if (checks > 1) return false
          expect(yield* KiloTaskPause.resume(child)).toBe(false)
          return true
        }),
      board: {} as Parameters<typeof KiloTaskPause.settle>[0]["board"],
    })
    const out = yield* awaitWithTimeout(settle, "the pause waited for a resume that already happened", "5 seconds")
    expect(out.paused).toBe(true)
    expect(checks).toBe(2)
    expect(KiloTaskPause.paused(child)).toBe(false)
  }),
)
